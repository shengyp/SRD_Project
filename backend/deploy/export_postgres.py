"""
导出 PostgreSQL mental_health 数据库到 SQL 文件
使用项目已有的 asyncpg
"""
import asyncio
import asyncpg
import os
from datetime import datetime

# PostgreSQL 连接参数
pg_config = {
    'host': 'localhost',
    'port': 5432,
    'database': 'mental_health',
    'user': 'postgres',
    'password': 'PgStr0ng2o26#vis4srd'
}

output_file = os.path.join(os.path.dirname(__file__), 'postgres_full.sql')


async def export_postgres():
    conn = None
    try:
        conn = await asyncpg.connect(**pg_config)

        # 获取所有表
        tables = await conn.fetch("""
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = 'public'
            ORDER BY table_name
        """)

        print('=== PostgreSQL mental_health 数据库表列表 ===')
        for t in tables:
            print(f'  - {t["table_name"]}')

        print(f'\n共 {len(tables)} 个表')

        # 开始生成 SQL 文件
        with open(output_file, 'w', encoding='utf-8') as f:
            f.write(f"-- ============================================\n")
            f.write(f"-- VIS4SRD PostgreSQL 完整数据库导出\n")
            f.write(f"-- 导出时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
            f.write(f"-- 数据库: mental_health\n")
            f.write(f"-- ============================================\n\n")

            # 创建 mental_health 数据库
            f.write("-- 创建 mental_health 数据库 (如需要)\n")
            f.write("-- 注意: 如果数据库已存在，请先删除或使用 psql 创建新库\n\n")

            for table in tables:
                table_name = table['table_name']
                print(f'导出表: {table_name} ...')

                # 获取表结构
                columns = await conn.fetch(f"""
                    SELECT column_name, data_type, character_maximum_length, is_nullable
                    FROM information_schema.columns
                    WHERE table_name = '{table_name}'
                    ORDER BY ordinal_position
                """)

                # 生成 CREATE TABLE 语句
                f.write(f"-- 表: {table_name}\n")
                f.write(f"DROP TABLE IF EXISTS {table_name} CASCADE;\n")
                f.write(f"CREATE TABLE {table_name} (\n")

                col_defs = []
                for col in columns:
                    col_name = col['column_name']
                    data_type = col['data_type']
                    max_len = col['character_maximum_length']
                    nullable = col['is_nullable']

                    col_def = f"    {col_name} {data_type}"
                    if max_len:
                        col_def += f"({max_len})"
                    if nullable == 'NO':
                        col_def += " NOT NULL"
                    col_defs.append(col_def)

                f.write(",\n".join(col_defs))
                f.write("\n);\n\n")

                # 导出数据
                rows = await conn.fetch(f"SELECT * FROM {table_name}")

                if rows:
                    for row in rows:
                        values = []
                        for val in row:
                            if val is None:
                                values.append('NULL')
                            elif isinstance(val, str):
                                val_escaped = val.replace("'", "''")
                                values.append(f"'{val_escaped}'")
                            elif isinstance(val, bool):
                                values.append('TRUE' if val else 'FALSE')
                            elif isinstance(val, (int, float)):
                                values.append(str(val))
                            elif isinstance(val, datetime):
                                values.append(f"'{val.isoformat()}'")
                            else:
                                val_str = str(val).replace("'", "''")
                                values.append(f"'{val_str}'")

                        f.write(f"INSERT INTO {table_name} VALUES ({', '.join(values)});\n")
                    f.write("\n")

        await conn.close()
        print(f'\n✅ 导出成功! 文件已保存到: {output_file}')

    except Exception as e:
        print(f'❌ 导出失败: {e}')
        import traceback
        traceback.print_exc()
        if conn:
            await conn.close()


if __name__ == '__main__':
    asyncio.run(export_postgres())
