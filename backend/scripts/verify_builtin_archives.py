"""
校验四个内置数据系列是否和数据库、首页统计、详情数据一致。

运行方式：
    ..\\.venv\\Scripts\\python.exe scripts\\verify_builtin_archives.py
"""
from __future__ import annotations

import ast
import asyncio
import csv
import json
import sys
from pathlib import Path
from typing import Any, Dict, List, Tuple
from urllib.request import urlopen
from decimal import Decimal

import aiomysql

PROJECT_ROOT = Path(__file__).resolve().parents[2]
BACKEND_ROOT = PROJECT_ROOT / "backend"
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from src.core.config import settings  # noqa: E402
from src.services.dataset_csv_service import DatasetCSVService  # noqa: E402

DATASETS = ("reddit", "bigdata", "sigir", "weibo")


def json_default(value: Any) -> Any:
    if isinstance(value, Decimal):
        return float(value)
    raise TypeError(f"Object of type {value.__class__.__name__} is not JSON serializable")


async def create_mysql_pool() -> aiomysql.Pool:
    return await aiomysql.create_pool(
        host=settings.DB_HOST,
        port=settings.DB_PORT,
        user=settings.DB_USER,
        password=settings.DB_PASSWORD,
        db=settings.DB_NAME,
        minsize=1,
        maxsize=2,
        autocommit=True,
        init_command="SET NAMES utf8mb4",
        use_unicode=True,
        charset="utf8mb4",
    )


def strict_bigdata_post_count(base_dir: Path) -> int:
    path = base_dir / "bigdata" / "bigdata.csv"
    total = 0
    with open(path, "r", encoding="utf-8-sig", errors="replace") as f:
        reader = csv.DictReader(f)
        for row in reader:
            raw = (row.get("post_sequence") or "").strip()
            if not raw:
                continue
            try:
                value = ast.literal_eval(raw.replace('\\"', '"'))
                total += len(value) if isinstance(value, list) else 1
            except Exception:
                total += 1
    return total


def fetch_home_stats() -> Dict[str, Any]:
    with urlopen("http://127.0.0.1:8000/api/home/stats?force_refresh=true", timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


async def fetch_db_dataset_summary(pool: aiomysql.Pool) -> Dict[str, Dict[str, Any]]:
    sql = """
    SELECT
        pa.dataset_source,
        COUNT(*) AS archives,
        COALESCE(SUM(pa.post_count), 0) AS posts,
        MIN(pa.risk_value) AS min_risk_value,
        MAX(pa.risk_value) AS max_risk_value,
        SUM(pa.risk_level = 'low') AS low_count,
        SUM(pa.risk_level = 'medium') AS medium_count,
        SUM(pa.risk_level = 'high') AS high_count
    FROM psychological_archives pa
    GROUP BY pa.dataset_source
    """
    result: Dict[str, Dict[str, Any]] = {}
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cursor:
            await cursor.execute("SET NAMES utf8mb4")
            await cursor.execute(sql)
            for row in await cursor.fetchall():
                result[row["dataset_source"]] = row
    return result


async def fetch_dataset_profile(pool: aiomysql.Pool) -> Dict[str, Dict[str, Any]]:
    sql = """
    SELECT dataset_key, total_users, total_posts, total_archives, class_count,
           fine_labels, coarse_risk_mapping
    FROM dataset_profile
    WHERE dataset_key IN ('reddit', 'bigdata', 'sigir', 'weibo')
    """
    result: Dict[str, Dict[str, Any]] = {}
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cursor:
            await cursor.execute("SET NAMES utf8mb4")
            await cursor.execute(sql)
            for row in await cursor.fetchall():
                result[row["dataset_key"]] = row
    return result


async def fetch_post_integrity(pool: aiomysql.Pool) -> Tuple[int, Dict[str, int]]:
    mismatch_sql = """
    SELECT COUNT(*) AS mismatch_count
    FROM (
        SELECT pa.id, pa.post_count AS expected_posts, COUNT(up.id) AS actual_posts
        FROM psychological_archives pa
        LEFT JOIN user_posts up ON up.archive_id = pa.id
        GROUP BY pa.id, pa.post_count
        HAVING expected_posts <> actual_posts
    ) t
    """
    zero_based_sql = """
    SELECT dataset_source, COUNT(*) AS zero_based_count
    FROM (
        SELECT pa.dataset_source, pa.id, MIN(up.post_index) AS min_post_index
        FROM psychological_archives pa
        JOIN user_posts up ON up.archive_id = pa.id
        GROUP BY pa.dataset_source, pa.id
    ) t
    WHERE min_post_index = 0
    GROUP BY dataset_source
    """
    zero_based: Dict[str, int] = {}
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cursor:
            await cursor.execute("SET NAMES utf8mb4")
            await cursor.execute(mismatch_sql)
            mismatch_row = await cursor.fetchone()
            await cursor.execute(zero_based_sql)
            for row in await cursor.fetchall():
                zero_based[row["dataset_source"]] = row["zero_based_count"]
    return (mismatch_row["mismatch_count"] if mismatch_row else 0, zero_based)


async def fetch_sample_archive_posts(pool: aiomysql.Pool, dataset_key: str, user_hash: str) -> Dict[str, Any]:
    sql = """
    SELECT up.post_index, up.content, up.importance_score, up.importance_level,
           up.fine_risk_value, up.post_timestamp, up.emoji_sequence
    FROM user_posts up
    INNER JOIN psychological_archives pa ON pa.id = up.archive_id
    WHERE pa.dataset_source = %s AND pa.user_id = %s
    ORDER BY up.post_index ASC
    LIMIT 3
    """
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cursor:
            await cursor.execute("SET NAMES utf8mb4")
            await cursor.execute(sql, (dataset_key, user_hash))
            return {"posts": await cursor.fetchall()}


async def main() -> int:
    svc = DatasetCSVService(base_dir=str(PROJECT_ROOT / "datasets"))
    pool = await create_mysql_pool()
    failures: List[str] = []

    try:
        profile = await fetch_dataset_profile(pool)
        db_summary = await fetch_db_dataset_summary(pool)
        mismatch_count, zero_based = await fetch_post_integrity(pool)
        home_stats = fetch_home_stats().get("data", {})

        print("== 内置数据系列一致性检查 ==")
        print()

        total_expected_archives = 0
        total_expected_posts = 0
        total_low = 0
        total_medium = 0
        total_high = 0

        for dataset_key in DATASETS:
            payload = svc.build_dataset_import_payload(dataset_key)
            if not payload:
                failures.append(f"{dataset_key}: 无法从 CSV 构建导入载荷")
                continue

            expected = payload["dataset"]
            expected_archives = payload["archives"]
            expected_low = sum(1 for item in expected_archives if item["risk_level"] == "low")
            expected_medium = sum(1 for item in expected_archives if item["risk_level"] == "medium")
            expected_high = sum(1 for item in expected_archives if item["risk_level"] == "high")

            total_expected_archives += expected["total_archives"]
            total_expected_posts += expected["total_posts"]
            total_low += expected_low
            total_medium += expected_medium
            total_high += expected_high

            db_row = db_summary.get(dataset_key, {})
            profile_row = profile.get(dataset_key, {})

            checks = {
                "dataset_profile.total_users": profile_row.get("total_users") == expected["total_users"],
                "dataset_profile.total_posts": profile_row.get("total_posts") == expected["total_posts"],
                "dataset_profile.total_archives": profile_row.get("total_archives") == expected["total_archives"],
                "dataset_profile.class_count": profile_row.get("class_count") == expected["class_count"],
                "psychological_archives.count": db_row.get("archives") == expected["total_archives"],
                "psychological_archives.sum_post_count": db_row.get("posts") == expected["total_posts"],
                "risk.low": db_row.get("low_count") == expected_low,
                "risk.medium": db_row.get("medium_count") == expected_medium,
                "risk.high": db_row.get("high_count") == expected_high,
            }
            failed_checks = [name for name, ok in checks.items() if not ok]
            if failed_checks:
                failures.append(f"{dataset_key}: {', '.join(failed_checks)}")

            sample_user = expected_archives[0]["user_hash"]
            sample_db = await fetch_sample_archive_posts(pool, dataset_key, sample_user)
            sample_expected_posts = expected_archives[0]["posts"][:3]
            sample_ok = True
            if len(sample_db["posts"]) != len(sample_expected_posts):
                sample_ok = False
            else:
                for db_post, expected_post in zip(sample_db["posts"], sample_expected_posts):
                    if db_post["post_index"] != expected_post["post_index"]:
                        sample_ok = False
                        break
                    if (db_post["content"] or "") != expected_post["content"]:
                        sample_ok = False
                        break
            if not sample_ok:
                failures.append(f"{dataset_key}: 详情抽样帖子与导入载荷不一致")

            print(f"[{dataset_key}]")
            print(
                json.dumps(
                    {
                        "expected": {
                            "archives": expected["total_archives"],
                            "posts": expected["total_posts"],
                            "classCount": expected["class_count"],
                            "risk": {"low": expected_low, "medium": expected_medium, "high": expected_high},
                        },
                        "db": {
                            "archives": db_row.get("archives"),
                            "posts": db_row.get("posts"),
                            "classCount": profile_row.get("class_count"),
                            "risk": {
                                "low": db_row.get("low_count"),
                                "medium": db_row.get("medium_count"),
                                "high": db_row.get("high_count"),
                            },
                        },
                        "sampleUser": sample_user,
                        "sampleFirstPostIndex": sample_db["posts"][0]["post_index"] if sample_db["posts"] else None,
                        "sampleFirstImportanceScore": sample_db["posts"][0]["importance_score"] if sample_db["posts"] else None,
                    },
                    ensure_ascii=False,
                    indent=2,
                    default=json_default,
                )
            )
            print()

        print("[global]")
        print(
            json.dumps(
                {
                    "homeStats": {
                        "totalArchives": home_stats.get("totalArchives"),
                        "totalPosts": home_stats.get("totalPosts"),
                        "riskDistribution": home_stats.get("riskDistribution"),
                    },
                    "expectedTotals": {
                        "totalArchives": total_expected_archives,
                        "totalPosts": total_expected_posts,
                        "risk": {"low": total_low, "medium": total_medium, "high": total_high},
                    },
                    "dbIntegrity": {
                        "postCountMismatchArchives": mismatch_count,
                        "zeroBasedPostIndexArchives": zero_based,
                    },
                    "bigdataStrictAstPosts": strict_bigdata_post_count(PROJECT_ROOT / "datasets"),
                    "bigdataRecoveredPosts": svc.build_dataset_import_payload("bigdata")["dataset"]["total_posts"],
                },
                ensure_ascii=False,
                indent=2,
                default=json_default,
            )
        )
        print()

        if home_stats.get("totalArchives") != total_expected_archives:
            failures.append("homeStats.totalArchives 与期望总档案数不一致")
        if home_stats.get("totalPosts") != total_expected_posts:
            failures.append("homeStats.totalPosts 与期望总帖子数不一致")
        risk_dist = home_stats.get("riskDistribution") or {}
        if (risk_dist.get("low") or {}).get("count") != total_low:
            failures.append("homeStats.low.count 与期望不一致")
        if (risk_dist.get("medium") or {}).get("count") != total_medium:
            failures.append("homeStats.medium.count 与期望不一致")
        if (risk_dist.get("high") or {}).get("count") != total_high:
            failures.append("homeStats.high.count 与期望不一致")
        if mismatch_count != 0:
            failures.append(f"仍有 {mismatch_count} 个档案的 post_count 与 user_posts 条数不一致")
        if zero_based:
            failures.append(f"仍存在 0-based post_index 档案: {zero_based}")

        if failures:
            print("RESULT: FAILED")
            for item in failures:
                print(f"- {item}")
            return 1

        print("RESULT: PASSED")
        return 0
    finally:
        pool.close()
        await pool.wait_closed()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
