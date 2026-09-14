"""空库首次启动时写入演示数据 —— 数据源是 `app/seed_snapshot.py`。

那份快照由 `scripts/export_seed_snapshot.py` 从真实数据库导出，
所以「空库 + 跑一次 seed」得到的结果与导出时的库**完全一致**
（日期是冻结的绝对日期，换一天跑也一样）。

想改演示数据：先把库调成想要的样子，再重新导出，**不要手改快照**。

与之并存的两个维护脚本用途不同，别搞混：
  - `scripts/reset_students.py`     按 demo_data.STUDENTS 重建账号与空白项目
  - `scripts/seed_student_demo.py`  给指定学生重灌往返 / 周报 / 问答（数据在 demo_data.DEMO）
"""
import json
import uuid
from datetime import datetime
from pathlib import Path

from sqlmodel import Session, select

from . import seed_snapshot as SNAP
from .auth import hash_password
from .database import UPLOAD_DIR, engine
from .demo_data import INITIAL_PASSWORD
from .models import (
    Announcement, Grade, Link, Question, Reply, ReportComment, Setting,
    ThesisProject, ThesisRound, User, WeeklyReport, RISK_CONFIG_KEY,
)


def _dt(value: str | None):
    """快照里的时间戳是绝对时间字符串，原样解析。"""
    return datetime.fromisoformat(value) if value else None


def _write_attachment(orig: str) -> str:
    """按原始文件名写出一份演示附件，返回新生成的存储名。

    ⚠️ 存储名是 uuid，每次跑都不同 —— 这是「无法逐字复现」的三处之一；
    界面显示的是 student_file_orig / teacher_file_orig，那部分是一致的。
    """
    stored = f"{uuid.uuid4().hex}{Path(orig).suffix}"
    (UPLOAD_DIR / stored).write_text(SNAP.ATTACHMENTS.get(orig, ""), encoding="utf-8")
    return stored


def seed():
    with Session(engine) as s:
        # 已存在数据则跳过（日常重启动不会重复灌种子）
        if s.exec(select(User)).first():
            return

        # ---------- 年级 ----------
        grades = {}
        for name in SNAP.GRADES:
            g = Grade(name=name)
            s.add(g)
            s.commit()
            s.refresh(g)
            grades[name] = g

        # ---------- 账号（老师排第一）----------
        users = {}
        for u in SNAP.USERS:
            row = User(
                username=u["username"], name=u["name"], role=u["role"],
                student_no=u["student_no"],
                grade_id=grades[u["grade"]].id if u["grade"] else None,
                password_hash=hash_password(INITIAL_PASSWORD),
            )
            s.add(row)
            s.commit()
            s.refresh(row)
            users[u["username"]] = row

        # ---------- 论文项目（含 8 节点 × 2 轨道里程碑）----------
        projects = {}
        for p in SNAP.PROJECTS:
            row = ThesisProject(
                student_id=users[p["student"]].id,
                title=p["title"], stage=p["stage"], progress=p["progress"],
                risk_override=p["risk_override"],
                milestones_json=json.dumps(p["milestones"], ensure_ascii=False),
            )
            s.add(row)
            s.commit()
            s.refresh(row)
            projects[p["student"]] = row

        # ---------- 多轮往返 + 附件 ----------
        for r in SNAP.ROUNDS:
            s.add(ThesisRound(
                project_id=projects[r["student"]].id,
                round_no=r["round_no"],
                student_text=r["student_text"],
                student_file=_write_attachment(r["student_file"]) if r["student_file"] else None,
                student_file_orig=r["student_file"],
                teacher_comment=r["teacher_comment"],
                teacher_file=_write_attachment(r["teacher_file"]) if r["teacher_file"] else None,
                teacher_file_orig=r["teacher_file"],
                submitted_at=_dt(r["submitted_at"]),
                feedback_at=_dt(r["feedback_at"]),
            ))
        s.commit()

        # ---------- 周报 + 点评 ----------
        week_ids = {}
        for r in SNAP.REPORTS:
            row = WeeklyReport(
                student_id=users[r["student"]].id, week=r["week"],
                content_md=r["content_md"],
                created_at=_dt(r["created_at"]), updated_at=_dt(r["updated_at"]),
            )
            s.add(row)
            s.commit()
            s.refresh(row)
            week_ids[(r["student"], r["week"])] = row.id
        for c in SNAP.REPORT_COMMENTS:
            s.add(ReportComment(
                report_id=week_ids[(c["student"], c["week"])],
                author_id=users[c["author"]].id,
                content=c["content"], created_at=_dt(c["created_at"]),
            ))
        s.commit()

        # ---------- 问答 ----------
        q_ids = []
        for q in SNAP.QUESTIONS:
            row = Question(author_id=users[q["author"]].id, content=q["content"],
                           created_at=_dt(q["created_at"]))
            s.add(row)
            s.commit()
            s.refresh(row)
            q_ids.append(row.id)
        for r in SNAP.REPLIES:
            s.add(Reply(question_id=q_ids[r["question"]], author_id=users[r["author"]].id,
                        content=r["content"], created_at=_dt(r["created_at"])))
        s.commit()

        # ---------- 公告 / 常用链接 ----------
        for a in SNAP.ANNOUNCEMENTS:
            s.add(Announcement(author_id=users[a["author"]].id, title=a["title"],
                               content=a["content"], created_at=_dt(a["created_at"])))
        for l in SNAP.LINKS:
            s.add(Link(title=l["title"], url=l["url"], created_by=users[l["created_by"]].id))
        s.commit()

        # ---------- 风险基准配置 ----------
        if SNAP.RISK_CONFIG:
            s.add(Setting(key=RISK_CONFIG_KEY,
                          value=json.dumps(SNAP.RISK_CONFIG, ensure_ascii=False)))
            s.commit()

        print(
            f"种子数据已写入：{len(SNAP.USERS)} 个账号（初始密码见 GM_SEED_PASSWORD）"
            f" + {len(SNAP.PROJECTS)} 个论文项目 + {len(SNAP.ROUNDS)} 轮往返"
            f" + {len(SNAP.REPORTS)} 份周报 + {len(SNAP.QUESTIONS)} 条提问"
        )
