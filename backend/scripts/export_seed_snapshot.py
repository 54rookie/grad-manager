"""把当前数据库导出成 `app/seed_snapshot.py`（初始化脚本用的数据快照）。

用途：线上/本地要一份「和当前库一致」的演示数据时，先按需要把库调成想要的
样子，再跑这个脚本重新导出，之后任何空库启动都会得到同一份数据。

    cd backend && ./.venv/bin/python scripts/export_seed_snapshot.py

导出的是**绝对日期**（不是「今天-125 天」那种相对值），所以换一天跑也完全一样。

三处导出时无法逐字复现、只能做到语义一致的东西（脚本里也会写进注释）：
  1. 密码哈希 —— bcrypt 每次加盐不同，只能统一设成 INITIAL_PASSWORD
  2. 附件的存储名 —— uuid，每次生成都不同；但**界面显示的原始文件名一致**
  3. 自增 id —— 按插入顺序重新分配（关系仍然正确，只是数值可能不同）
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlmodel import Session, select  # noqa: E402

from app.database import engine  # noqa: E402
from app.models import (  # noqa: E402
    Announcement, Grade, Link, Question, Reply, ReportComment, Setting,
    ThesisProject, ThesisRound, User, WeeklyReport, RISK_CONFIG_KEY,
)

OUT = Path(__file__).resolve().parent.parent / "app" / "seed_snapshot.py"


def lit(value, indent=0):
    """把 Python 值格式化成可读、且逐字保真的字面量。"""
    if isinstance(value, str):
        return repr(value)
    if isinstance(value, (int, float)) or value is None:
        return repr(value)
    if isinstance(value, list):
        if not value:
            return "[]"
        pad = " " * (indent + 4)
        inner = ",\n".join(f"{pad}{lit(v, indent + 4)}" for v in value)
        return f"[\n{inner},\n{' ' * indent}]"
    if isinstance(value, dict):
        if not value:
            return "{}"
        pad = " " * (indent + 4)
        inner = ",\n".join(f"{pad}{lit(k, indent + 4)}: {lit(v, indent + 4)}" for k, v in value.items())
        return f"{{\n{inner},\n{' ' * indent}}}"
    raise TypeError(f"不支持的类型: {type(value)}")


def block(name, value, comment=None):
    head = f"# {comment}\n" if comment else ""
    return f"{head}{name} = {lit(value)}\n\n"


def main():
    with Session(engine) as s:
        users = {u.id: u for u in s.exec(select(User)).all()}
        grades = {g.id: g for g in s.exec(select(Grade)).all()}
        name_of = lambda uid: (users[uid].username if uid in users else "?")  # noqa: E731

        # 年级（按 id 顺序，保证新库里 id 也对得上）
        grade_rows = [g.name for g in sorted(grades.values(), key=lambda g: g.id)]

        # 用户
        user_rows = []
        for u in sorted(users.values(), key=lambda u: (u.role != "teacher", u.id)):
            user_rows.append({
                "username": u.username, "name": u.name, "role": u.role,
                "student_no": u.student_no,
                "grade": grades[u.grade_id].name if u.grade_id in grades else None,
            })

        # 项目（里程碑 JSON 原样保留）
        projects = s.exec(select(ThesisProject)).all()
        project_rows = []
        for p in sorted(projects, key=lambda p: p.id):
            project_rows.append({
                "student": name_of(p.student_id),
                "title": p.title, "stage": p.stage, "progress": p.progress,
                "risk_override": p.risk_override,
                "milestones": json.loads(p.milestones_json or "[]"),
            })

        # 附件正文：原始文件名 → 内容（按当前 uploads 里的实际内容导出）
        from app.database import UPLOAD_DIR
        attachment_body = {}
        by_student = {p.student_id: p for p in projects}
        pid_to_student = {p.id: p.student_id for p in projects}

        rounds = s.exec(select(ThesisRound)).all()
        round_rows = []
        for r in sorted(rounds, key=lambda r: r.id):
            for stored, orig in ((r.student_file, r.student_file_orig), (r.teacher_file, r.teacher_file_orig)):
                if stored and orig:
                    f = UPLOAD_DIR / stored
                    if f.exists():
                        attachment_body[orig] = f.read_text(encoding="utf-8", errors="replace")
            round_rows.append({
                "student": name_of(pid_to_student[r.project_id]),
                "round_no": r.round_no,
                "student_text": r.student_text,
                "student_file": r.student_file_orig,
                "teacher_comment": r.teacher_comment,
                "teacher_file": r.teacher_file_orig,
                "submitted_at": r.submitted_at.isoformat(sep=" ", timespec="microseconds") if r.submitted_at else None,
                "feedback_at": r.feedback_at.isoformat(sep=" ", timespec="microseconds") if r.feedback_at else None,
            })

        # 周报与点评
        reports = sorted(s.exec(select(WeeklyReport)).all(), key=lambda r: r.id)
        week_of_report = {r.id: (r.student_id, r.week) for r in reports}
        report_rows = [{
            "student": name_of(r.student_id), "week": r.week, "content_md": r.content_md,
            "created_at": r.created_at.isoformat(sep=" ", timespec="microseconds"),
            "updated_at": r.updated_at.isoformat(sep=" ", timespec="microseconds"),
        } for r in reports]

        comment_rows = []
        for c in sorted(s.exec(select(ReportComment)).all(), key=lambda c: c.id):
            sid, week = week_of_report[c.report_id]
            comment_rows.append({
                "student": name_of(sid), "week": week, "author": name_of(c.author_id),
                "content": c.content,
                "created_at": c.created_at.isoformat(sep=" ", timespec="microseconds"),
            })

        # 问答
        questions = sorted(s.exec(select(Question)).all(), key=lambda q: q.id)
        q_index = {q.id: i for i, q in enumerate(questions)}
        question_rows = [{
            "author": name_of(q.author_id), "content": q.content,
            "created_at": q.created_at.isoformat(sep=" ", timespec="microseconds"),
        } for q in questions]
        reply_rows = [{
            "question": q_index[r.question_id], "author": name_of(r.author_id),
            "content": r.content,
            "created_at": r.created_at.isoformat(sep=" ", timespec="microseconds"),
        } for r in sorted(s.exec(select(Reply)).all(), key=lambda r: r.id)]

        # 公告 / 链接
        ann_rows = [{
            "author": name_of(a.author_id), "title": a.title, "content": a.content,
            "created_at": a.created_at.isoformat(sep=" ", timespec="microseconds"),
        } for a in sorted(s.exec(select(Announcement)).all(), key=lambda a: a.id)]
        link_rows = [{
            "title": l.title, "url": l.url, "created_by": name_of(l.created_by),
        } for l in sorted(s.exec(select(Link)).all(), key=lambda l: l.id)]

        cfg_row = s.get(Setting, RISK_CONFIG_KEY)
        risk_config = json.loads(cfg_row.value) if cfg_row and cfg_row.value else None

    out = [
        '"""演示数据快照 —— **由 scripts/export_seed_snapshot.py 从真实数据库导出**，不要手写。\n',
        "\n",
        "seed.py 读这份数据把空库灌成与导出时**完全一致**的状态。\n",
        "日期全部是绝对日期（已冻结），所以换一天跑结果也一样。\n",
        "\n",
        "想改演示数据：先把库调成想要的样子，再跑\n",
        "    cd backend && ./.venv/bin/python scripts/export_seed_snapshot.py\n",
        "重新导出即可。\n",
        "\n",
        "三处无法逐字复现（只能语义一致）：\n",
        "  1. 密码哈希 —— bcrypt 每次加盐不同，统一用 INITIAL_PASSWORD\n",
        "  2. 附件存储名 —— uuid 每次不同；界面显示的原始文件名一致\n",
        "  3. 自增 id —— 按插入顺序重新分配（关系正确，数值可能不同）\n",
        '"""\n\n',
        block("GRADES", grade_rows, "年级（按原 id 顺序，保证新库里 id 也对得上）"),
        block("USERS", user_rows, "账号：老师排在第一，其余按原 id 顺序"),
        block("PROJECTS", project_rows, "论文项目（含 8 节点 × 2 轨道的完整里程碑）"),
        block("ATTACHMENTS", attachment_body, "演示附件的正文：原始文件名 → 内容"),
        block("ROUNDS", round_rows, "多轮往返（student_submitted_at / feedback_at 为绝对时间）"),
        block("REPORTS", report_rows, "周报"),
        block("REPORT_COMMENTS", comment_rows, "周报点评"),
        block("QUESTIONS", question_rows, "问答主贴"),
        block("REPLIES", reply_rows, "问答回复（question 是 QUESTIONS 里的下标）"),
        block("ANNOUNCEMENTS", ann_rows, "公告"),
        block("LINKS", link_rows, "常用链接"),
        block("RISK_CONFIG", risk_config, "风险基准配置（与 Setting 表里的一致）"),
    ]
    OUT.write_text("".join(out), encoding="utf-8")
    print(f"已导出 → {OUT}")
    print(f"  年级 {len(grade_rows)} / 用户 {len(user_rows)} / 项目 {len(project_rows)}")
    print(f"  往返 {len(round_rows)} / 周报 {len(report_rows)} / 点评 {len(comment_rows)}")
    print(f"  问答 {len(question_rows)}+{len(reply_rows)} / 公告 {len(ann_rows)} / 链接 {len(link_rows)}")
    print(f"  附件 {len(attachment_body)} 个")


if __name__ == "__main__":
    main()
