"""数据库与上传目录路径：可用环境变量覆盖（便于测试或重定向部署）。

- GM_DB_PATH      SQLite 库文件路径（默认 backend/grad_manager.db）
- GM_UPLOAD_DIR   上传文件目录（默认 backend/uploads）
"""
import os
from pathlib import Path

from sqlmodel import SQLModel, create_engine, Session

BASE_DIR = Path(__file__).resolve().parent.parent
DB_PATH = Path(os.environ.get("GM_DB_PATH", BASE_DIR / "grad_manager.db"))
UPLOAD_DIR = Path(os.environ.get("GM_UPLOAD_DIR", BASE_DIR / "uploads"))
if not UPLOAD_DIR.exists():
    UPLOAD_DIR.mkdir(parents=True)

engine = create_engine(f"sqlite:///{DB_PATH}", connect_args={"check_same_thread": False})


# 给已存在的表补新列（表名 → [(列名, SQLite 类型)]）。
# create_all() 只建缺失的「表」，不会给已存在的表加「列」，
# 所以模型新增字段时必须在这里显式登记，否则老库一查就报 no such column。
ADDED_COLUMNS = {
    "thesisproject": [("risk_override", "VARCHAR")],
}


def _ensure_columns():
    with engine.connect() as conn:
        for table, cols in ADDED_COLUMNS.items():
            have = {row[1] for row in conn.exec_driver_sql(f"PRAGMA table_info({table})")}
            for name, ddl in cols:
                if name not in have:
                    conn.exec_driver_sql(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}")
        conn.commit()


def init_db():
    SQLModel.metadata.create_all(engine)
    _ensure_columns()


def get_session():
    with Session(engine) as session:
        yield session
