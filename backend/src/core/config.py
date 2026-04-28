# 全局配置（环境变量 + 默认值）
import os
from pathlib import Path

# 项目根目录：backend/
BASE_DIR = Path(__file__).resolve().parent.parent.parent


def _env(key: str, default: str = "") -> str:
    return os.getenv(key, default)


class Settings:
    """应用配置，从环境变量读取，便于测试与 Docker 覆盖。"""

    # 服务
    HOST: str = _env("HOST", "0.0.0.0")
    PORT: int = int(_env("PORT", "3000"))

    # MySQL（主业务库）
    DB_HOST: str = _env("DB_HOST", "localhost")
    DB_PORT: int = int(_env("DB_PORT", "3306"))
    DB_USER: str = _env("DB_USER", "mental_user")
    DB_PASSWORD: str = _env("DB_PASSWORD", "mental_password")
    DB_NAME: str = _env("DB_NAME", "vis4srd")

    # PostgreSQL + PostGIS（地理/机构）
    PG_HOST: str = _env("PG_HOST", "localhost")
    PG_PORT: int = int(_env("PG_PORT", "5432"))
    PG_NAME: str = _env("PG_NAME", "mental_health")
    PG_USER: str = _env("PG_USER", "postgres")
    PG_PASSWORD: str = _env("PG_PASSWORD", "PgStr0ng2o26#vis4srd")

    # 连接池
    MYSQL_POOL_MIN: int = 2
    MYSQL_POOL_MAX: int = 10
    PG_POOL_MIN: int = 2
    PG_POOL_MAX: int = 10

    # 上传目录（相对 backend/，指向 knowledge 目录）
    UPLOAD_DIR: Path = BASE_DIR.parent / "knowledge"


settings = Settings()
