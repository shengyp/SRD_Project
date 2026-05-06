"""
将四个内置数据系列同步到 MySQL。

用法：
    在 backend/ 目录执行
    ..\\.venv\\Scripts\\python.exe scripts\\sync_builtin_datasets.py

可选：
    ..\\.venv\\Scripts\\python.exe scripts\\sync_builtin_datasets.py reddit bigdata
"""
import asyncio
import os
import sys
import io
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")


CURRENT_FILE = Path(__file__).resolve()
BACKEND_ROOT = CURRENT_FILE.parent.parent
PROJECT_ROOT = BACKEND_ROOT.parent

if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

ENV_PATH = BACKEND_ROOT / ".env"
if ENV_PATH.exists():
    from dotenv import load_dotenv
    load_dotenv(ENV_PATH)


async def main(dataset_keys: list[str]) -> int:
    from src.core.database import init_pools, close_pools, get_mysql_pool
    from src.services.dataset_service import DatasetService
    from src.services.dataset_csv_service import DatasetCSVService

    await init_pools()
    try:
        mysql_pool = get_mysql_pool()
        if mysql_pool is None:
            print("MySQL 连接池不可用")
            return 1

        dataset_service = DatasetService(mysql_pool)
        csv_service = DatasetCSVService(base_dir=str(PROJECT_ROOT / "datasets"))
        result = await dataset_service.sync_builtin_datasets(
            csv_svc=csv_service,
            dataset_keys=dataset_keys or None,
        )
        print(result)
        return 0 if not result.get("failed") else 2
    finally:
        await close_pools()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main(sys.argv[1:])))
