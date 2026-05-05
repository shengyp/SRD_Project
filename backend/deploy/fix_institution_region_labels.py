import asyncio
import csv
import json
from pathlib import Path

import asyncpg


ROOT = Path(__file__).resolve().parents[2]
CSV_PATH = ROOT / "map_data" / "全国心理机构_完整数据.csv"
JSON_PATH = ROOT / "map_data" / "全国心理机构_完整数据.json"
SQL_PATH = ROOT / "backend" / "deploy" / "postgres_full.sql"
ENV_PATH = ROOT / "backend" / ".env"


CORRECTIONS = {
    "B0FFH0N5U4": {"province": "江苏省", "city": "无锡市", "district": "滨湖区"},
    "B0FFGZGAPD": {"province": "广东省", "city": "汕头市", "district": "龙湖区"},
    "B017600OY4": {"province": "河南省", "city": "许昌市", "district": "魏都区"},
    "B0J02CPBHP": {"province": "河北省", "city": "唐山市", "district": "路北区"},
    "B02DD01291": {"province": "湖南省", "city": "株洲市", "district": "荷塘区"},
    "B027B016C8": {"province": "山东省", "city": "聊城市", "district": "东昌府区"},
    "B0FFG6BTG3": {"province": "吉林省", "city": "吉林市", "district": "船营区"},
    "B013E00CQT": {"province": "河北省", "city": "衡水市", "district": "桃城区"},
    "B02190ABBF": {"province": "山东省", "city": "济宁市", "district": "任城区"},
    "B020200BIF": {"province": "江苏省", "city": "扬州市", "district": "广陵区"},
    "B0FFIP32P9": {"province": "广东省", "city": "中山市", "district": ""},
}


def load_env(path: Path) -> dict:
    data = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        data[key.strip()] = value.strip()
    return data


def update_csv() -> int:
    with CSV_PATH.open("r", encoding="utf-8-sig", newline="") as f:
        rows = list(csv.DictReader(f))
        fieldnames = rows[0].keys() if rows else []

    changed = 0
    for row in rows:
        poi_id = row.get("POI_ID", "")
        correction = CORRECTIONS.get(poi_id)
        if not correction:
            continue
        if row.get("城市") != correction["city"] or row.get("区县") != correction["district"]:
            row["城市"] = correction["city"]
            row["区县"] = correction["district"]
            changed += 1

    with CSV_PATH.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)
    return changed


def update_json() -> int:
    data = json.loads(JSON_PATH.read_text(encoding="utf-8"))
    changed = 0
    for row in data:
        poi_id = row.get("POI_ID", "")
        correction = CORRECTIONS.get(poi_id)
        if not correction:
            continue
        if (
            row.get("城市") != correction["city"]
            or row.get("区县") != correction["district"]
            or row.get("省份") != correction["province"]
        ):
            row["城市"] = correction["city"]
            row["区县"] = correction["district"]
            row["省份"] = correction["province"]
            changed += 1

    JSON_PATH.write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return changed


def update_postgres_sql() -> int:
    lines = SQL_PATH.read_text(encoding="utf-8").splitlines()
    in_copy = False
    changed = 0

    for idx, line in enumerate(lines):
        if line.startswith("COPY public.institutions "):
            in_copy = True
            continue
        if in_copy and line == "\\.":
            break
        if not in_copy or not line.strip():
            continue

        parts = line.split("\t")
        if len(parts) < 14:
            continue
        poi_id = parts[12]
        correction = CORRECTIONS.get(poi_id)
        if not correction:
            continue

        if parts[3] != correction["province"] or parts[4] != correction["city"] or parts[5] != correction["district"]:
            parts[3] = correction["province"]
            parts[4] = correction["city"]
            parts[5] = correction["district"]
            lines[idx] = "\t".join(parts)
            changed += 1

    SQL_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return changed


async def update_live_db() -> int:
    env = load_env(ENV_PATH)
    conn = await asyncpg.connect(
        host=env["PG_HOST"],
        port=int(env["PG_PORT"]),
        user=env["PG_USER"],
        password=env["PG_PASSWORD"],
        database=env["PG_NAME"],
    )
    try:
        changed = 0
        for poi_id, correction in CORRECTIONS.items():
            result = await conn.execute(
                """
                UPDATE institutions
                SET province = $1,
                    city = $2,
                    district = $3,
                    updated_at = NOW()
                WHERE poi_id = $4
                """,
                correction["province"],
                correction["city"],
                correction["district"],
                poi_id,
            )
            if result.endswith("1"):
                changed += 1
        return changed
    finally:
        await conn.close()


async def main() -> None:
    csv_changed = update_csv()
    json_changed = update_json()
    sql_changed = update_postgres_sql()
    db_changed = await update_live_db()
    print(
        json.dumps(
            {
                "csv_changed": csv_changed,
                "json_changed": json_changed,
                "sql_changed": sql_changed,
                "db_changed": db_changed,
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    asyncio.run(main())
