"""账号重排：清除全部旧学生（含其论文/周报/问答数据），按新名单重建 24/25/26 级学生。

用法：cd backend && ./.venv/bin/python scripts/reset_students.py
"""
import json
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

from sqlmodel import Session, select  # noqa: E402

from app.auth import hash_password  # noqa: E402
from app.database import UPLOAD_DIR, engine  # noqa: E402
from app.demo_data import INITIAL_PASSWORD, STUDENTS  # noqa: E402
from app.models import (  # noqa: E402
    DEFAULT_MILESTONES, Announcement, Grade, Link, Question, Reply,
    ReportComment, ReportAttachment, ThesisProject, ThesisRound, User, WeeklyReport,
)

KEEP_GRADES = sorted({gname for _, _, _, gname in STUDENTS})


def main():
    with Session(engine) as s:
        students = s.exec(select(User).where(User.role == "student")).all()
        ids = [u.id for u in students]
        print(f"待清理学生 {len(ids)} 个：{[u.name for u in students]}")

        # 1) 论文项目 + 往返
        orphan_files = []
        for p in s.exec(select(ThesisProject)).all():
            if p.student_id not in ids:
                continue
            for r in s.exec(select(ThesisRound).where(ThesisRound.project_id == p.id)).all():
                for f in (r.student_file, r.teacher_file):
                    if f:
                        orphan_files.append(f)
                s.delete(r)
            s.delete(p)

        # 2) 周报 + 点评
        for r in s.exec(select(WeeklyReport)).all():
            if r.student_id in ids:
                for a in s.exec(select(ReportAttachment).where(ReportAttachment.report_id == r.id)).all():
                    orphan_files.append(a.stored_name)
                    s.delete(a)
                for c in s.exec(select(ReportComment).where(ReportComment.report_id == r.id)).all():
                    s.delete(c)
                s.delete(r)
        for c in s.exec(select(ReportComment)).all():
            if c.author_id in ids:
                s.delete(c)

        # 3) 问答
        for q in s.exec(select(Question)).all():
            if q.author_id in ids:
                for rep in s.exec(select(Reply).where(Reply.question_id == q.id)).all():
                    s.delete(rep)
                s.delete(q)
        for rep in s.exec(select(Reply)).all():
            if rep.author_id in ids:
                s.delete(rep)

        # 4) 删除学生账号
        for u in students:
            s.delete(u)
        s.commit()

        # 5) 清理孤立附件文件
        removed = 0
        for f in set(orphan_files):
            path = UPLOAD_DIR / f
            if path.exists() and path.is_file():
                path.unlink()
                removed += 1
        print(f"清理附件 {removed} 个")

        # 6) 年级：确保 KEEP_GRADES 存在，删除其余
        grades = {g.name: g for g in s.exec(select(Grade)).all()}
        for name in KEEP_GRADES:
            if name not in grades:
                g = Grade(name=name)
                s.add(g)
                s.commit()
                s.refresh(g)
                grades[name] = g
                print(f"新增年级 {name}")
        for name, g in list(grades.items()):
            if name not in KEEP_GRADES:
                s.delete(g)
                print(f"删除年级 {name}")
        s.commit()

        # 7) 建立新学生账号 + 各自论文项目（学生名单来自 app.demo_data，与 seed / demo 脚本保持一致）
        for uname, name, no, gname in STUDENTS:
            u = User(
                username=uname, password_hash=hash_password(INITIAL_PASSWORD),
                name=name, role="student", student_no=no, grade_id=grades[gname].id,
            )
            s.add(u)
            s.commit()
            s.refresh(u)
            s.add(ThesisProject(
                student_id=u.id, title="",
                stage="开题", progress=0,
                milestones_json=json.dumps(DEFAULT_MILESTONES, ensure_ascii=False),
            ))
            print(f"  + {gname} {name}（{uname} / {no}）")

        s.commit()

        # 8) 汇总
        print("\n=== 当前账号总览 ===")
        for u in s.exec(select(User)).all():
            g = s.get(Grade, u.grade_id) if u.grade_id else None
            print(f"  {u.role:<8} {u.name:<6} {u.username:<14} {g.name if g else '—':<8} {u.student_no or ''}")


if __name__ == "__main__":
    main()
