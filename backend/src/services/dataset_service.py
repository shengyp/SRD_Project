# 数据集业务：配置缓存、列表、对比、上传
import re
import csv
import io
import json
from datetime import datetime
from typing import Dict, Tuple, List, Any, Optional

from src.core.constants import TABLE_DATASET_ANALYSIS, TABLE_CUSTOM_DATASET_META


def _sanitize_col(name: str) -> str:
    name = re.sub(r"[^a-zA-Z0-9_\u4e00-\u9fff]", "_", name.strip())
    if not name or name[0].isdigit():
        name = "col_" + name
    return name[:64]


def _sanitize_table(name: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9_]", "_", name.strip().lower())
    cleaned = re.sub(r"_+", "_", cleaned).strip("_")
    return cleaned[:30] or "dataset"


class DatasetService:
    """数据集相关业务，依赖 MySQL 连接池。"""

    def __init__(self, mysql_pool):
        self.mysql_pool = mysql_pool

    async def ensure_custom_dataset_meta_table(self) -> None:
        """确保 custom_dataset_meta 表存在（无则创建）。"""
        async with self.mysql_pool.acquire() as conn:
            async with conn.cursor() as cursor:
                await cursor.execute("SET NAMES utf8mb4")
                await cursor.execute("""
                    CREATE TABLE IF NOT EXISTS custom_dataset_meta (
                        id BIGINT AUTO_INCREMENT PRIMARY KEY,
                        name VARCHAR(255) NOT NULL COMMENT '数据集名称',
                        table_name VARCHAR(100) NOT NULL COMMENT '存储表名',
                        mode_type VARCHAR(50) DEFAULT 'all' COMMENT '模式类型',
                        row_count INT DEFAULT 0 COMMENT '记录数',
                        columns_info JSON COMMENT '字段映射信息',
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
                """)
                await conn.commit()

    async def get_datasets(self) -> List[dict]:
        """获取数据集列表。直接从 dataset_profile 表读取。"""
        result = []
        async with self.mysql_pool.acquire() as conn:
            async with conn.cursor() as cursor:
                await cursor.execute("SET NAMES utf8mb4")
                # 从 dataset_profile 表读取数据集信息
                await cursor.execute(
                    """
                    SELECT 
                        dataset_key,
                        display_name,
                        description,
                        icon,
                        color,
                        bg_color,
                        text_color,
                        language,
                        class_system,
                        class_count,
                        fine_labels,
                        coarse_risk_mapping,
                        total_users,
                        total_posts,
                        total_archives,
                        is_builtin,
                        is_active,
                        sort_order
                    FROM dataset_profile
                    ORDER BY sort_order ASC
                    """
                )
                async for row in cursor:
                    (
                        dataset_key, display_name, description, icon, color, 
                        bg_color, text_color, language, class_system, class_count,
                        fine_labels, coarse_risk_mapping, total_users, total_posts,
                        total_archives, is_builtin, is_active, sort_order
                    ) = row
                    
                    # 解析 JSON 字段
                    fine_labels_dict = {}
                    coarse_risk_map = {}
                    
                    if fine_labels:
                        try:
                            if isinstance(fine_labels, str):
                                fine_labels_dict = json.loads(fine_labels)
                            else:
                                fine_labels_dict = fine_labels
                        except:
                            pass
                    
                    if coarse_risk_mapping:
                        try:
                            if isinstance(coarse_risk_mapping, str):
                                coarse_risk_map = json.loads(coarse_risk_mapping)
                            else:
                                coarse_risk_map = coarse_risk_mapping
                        except:
                            pass
                    
                    # 计算总档案数（优先用统计字段，否则用用户数）
                    total_archives = total_archives or total_users or 0
                    
                    result.append({
                        "id": sort_order,
                        "datasetKey": dataset_key,
                        "displayName": display_name,
                        "description": description or "",
                        "icon": icon,
                        "color": color,
                        "bgColor": bg_color,
                        "textColor": text_color,
                        "language": language,
                        "classSystem": class_system,
                        "classCount": class_count or 2,
                        "fineLabels": fine_labels_dict,
                        "coarseRiskMapping": coarse_risk_map,
                        "totalUsers": total_users or 0,
                        "totalPosts": total_posts or 0,
                        "totalArchives": total_archives,
                        "isBuiltin": bool(is_builtin),
                        "isActive": bool(is_active) if is_active is not None else True,
                        "sortOrder": sort_order or 0,
                    })
        return result

    async def get_dataset_by_key(self, dataset_key: str) -> Optional[dict]:
        """根据 dataset_key 获取单个数据集。"""
        datasets = await self.get_datasets()
        for ds in datasets:
            if ds["datasetKey"] == dataset_key:
                return ds
        return None

    async def get_external_datasets(self) -> List[dict]:
        """获取外部导入的数据集（从 custom_dataset_meta 表）。"""
        result = []
        async with self.mysql_pool.acquire() as conn:
            async with conn.cursor() as cursor:
                await cursor.execute("SET NAMES utf8mb4")
                await cursor.execute(
                    """
                    SELECT id, name, table_name, mode_type, row_count, columns_info, created_at 
                    FROM custom_dataset_meta ORDER BY created_at DESC
                    """
                )
                rows = await cursor.fetchall()
                for r in rows:
                    result.append({
                        "id": f"ext_{r[0]}",
                        "meta_id": r[0],
                        "name": r[1],
                        "table_name": r[2],
                        "mode_type": r[3],
                        "row_count": r[4],
                        "columns_info": r[5],
                        "created_at": r[6].isoformat() if r[6] else None,
                    })
        return result


    async def get_dataset_config(self, force_refresh: bool = False) -> dict:
        """获取数据集配置信息。

        返回格式：
        {
            'REDDIT': {'csv_path': 'reddit/reddit_500.csv', 'language': 'en', ...},
            ...
        }

        注意：内置数据集数据从 datasets/ CSV 文件读取。
        该方法已不再被 UserService 使用，仅保留兼容。
        """
        from src.services.dataset_csv_service import DatasetCSVService
        csv_svc = DatasetCSVService()
        datasets = csv_svc.list_dataset_csvs()
        config = {}
        for ds in datasets:
            ds_key = ds.get("datasetKey", "").upper()
            config[ds_key] = ds
        return config

    async def get_datasets_compare(self) -> List[dict]:
        """获取数据集对比数据。直接从 dataset_profile 表读取。"""
        result = []
        async with self.mysql_pool.acquire() as conn:
            async with conn.cursor() as cursor:
                await cursor.execute("SET NAMES utf8mb4")
                await cursor.execute(
                    """
                    SELECT 
                        dataset_key,
                        display_name,
                        language,
                        class_system,
                        class_count,
                        total_users,
                        total_archives,
                        sort_order
                    FROM dataset_profile
                    ORDER BY sort_order ASC
                    """
                )
                async for row in cursor:
                    (dataset_key, display_name, language, class_system, 
                     class_count, total_users, total_archives, sort_order) = row
                    
                    total = total_users or 0
                    balance_ratio = 0.5
                    
                    result.append({
                        "id": dataset_key,
                        "name": display_name,
                        "type": "builtin",
                        "total": total,
                        "user_count": total,
                        "timestamp": True,
                        "language": language,
                        "structure": "social_media",
                        "balance": "balanced" if balance_ratio >= 0.3 else "imbalanced",
                        "balance_ratio": balance_ratio,
                        "task": "risk_detection",
                        "task_type": class_system,
                        "class_count": class_count or 2,
                    })
        return result

    async def import_dataset(
        self,
        name: str,
        fieldnames: List[str],
        reader,
        mode_type: str = "all",
        label_field: Optional[str] = None,
        timestamp_field: Optional[str] = None,
        post_field: Optional[str] = None,
    ) -> dict:
        """导入数据集。"""
        safe_name = _sanitize_table(name)
        ts = datetime.now().strftime("%Y%m%d%H%M")
        table_name = f"ext_{safe_name}_{ts}"
        col_map = {f: _sanitize_col(f) for f in fieldnames}
        safe_cols = list(col_map.values())
        rows = list(reader)

        async with self.mysql_pool.acquire() as conn:
            async with conn.cursor() as cursor:
                await cursor.execute("SET NAMES utf8mb4")
                cols_ddl = ", ".join(f"`{c}` TEXT" for c in safe_cols)
                await cursor.execute(
                    f"CREATE TABLE IF NOT EXISTS `{table_name}` "
                    f"(id INT PRIMARY KEY AUTO_INCREMENT, {cols_ddl}) "
                    f"ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
                )
                placeholders = ", ".join(["%s"] * len(safe_cols))
                insert_sql = (
                    f"INSERT INTO `{table_name}` ({', '.join(f'`{c}`' for c in safe_cols)}) "
                    f"VALUES ({placeholders})"
                )
                for row in rows:
                    vals = [row.get(f) for f in fieldnames]
                    await cursor.execute(insert_sql, vals)

                columns_info = json.dumps(
                    {old: new for old, new in zip(fieldnames, safe_cols)},
                    ensure_ascii=False,
                )
                await cursor.execute(
                    """INSERT INTO custom_dataset_meta (name, table_name, mode_type, row_count, columns_info)
                       VALUES (%s, %s, %s, %s, %s)""",
                    (name, table_name, mode_type, len(rows), columns_info),
                )
                await conn.commit()

                if label_field:
                    try:
                        await cursor.execute(f"SELECT COUNT(*) FROM `{table_name}`")
                        sample_count = (await cursor.fetchone())[0]
                        await cursor.execute(
                            f"SELECT COUNT(DISTINCT user_id) FROM `{table_name}`"
                        )
                        uc = await cursor.fetchone()
                        user_count = uc[0] if uc and uc[0] else sample_count
                        await cursor.execute(
                            f"SELECT DISTINCT {label_field} FROM `{table_name}`"
                        )
                        classes = await cursor.fetchall()
                        class_count = len(classes)
                    except Exception:
                        sample_count = len(rows)
                        user_count = sample_count
                        class_count = 2
                else:
                    sample_count = len(rows)
                    user_count = sample_count
                    class_count = 2

                await cursor.execute(
                    "SELECT id FROM custom_dataset_meta WHERE table_name = %s",
                    (table_name,),
                )
                row_meta = await cursor.fetchone()
                new_id = row_meta[0] if row_meta else None

        return {
            "id": new_id,
            "name": name,
            "table_name": table_name,
            "row_count": len(rows),
            "columns": safe_cols,
            "mode_type": mode_type,
        }
