"""数据库与上传目录路径：可用环境变量覆盖（便于测试或重定向部署）。

- GM_DB_PATH      SQLite 库文件路径（默认 backend/grad_manager.db）
- GM_UPLOAD_DIR   上传文件目录（默认 backend/uploads）
"""
import os
from pathlib import Path

from sqlmodel import SQLModel, create_engine, Session, select

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


def _migrate_milestones():
    """把旧版「6 节点·单论文」的里程碑升级成「8 节点 × 2 论文轨道」。

    判定依据：新版每项都带 track 字段，旧版没有。
    幂等 —— 已经是新结构的直接跳过，所以每次启动都能放心调。
    只把旧的 actual/plan 按标签搬到「论文 1」轨道，其它字段一律不动。
    """
    import json

    from .models import ThesisProject, upgrade_legacy_milestones

    with Session(engine) as session:
        changed = 0
        for p in session.exec(select(ThesisProject)).all():
            try:
                ms = json.loads(p.milestones_json or "[]")
            except json.JSONDecodeError:
                continue
            fresh = upgrade_legacy_milestones(ms)
            if fresh is None:
                continue  # 已经是新结构，或空数据
            p.milestones_json = json.dumps(fresh, ensure_ascii=False)
            session.add(p)
            changed += 1
        if changed:
            session.commit()
            print(f"[migrate] 已把 {changed} 份旧里程碑升级为 8 节点 × 2 论文轨道"
                  f"（映射表见 models.LEGACY_LABEL_MAP）")


def init_db():
    SQLModel.metadata.create_all(engine)
    _ensure_columns()
    _migrate_milestones()


def get_session():
    with Session(engine) as session:
        yield session
