from datetime import datetime, date, timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from ..auth import get_current_user, require_teacher
from ..database import get_session
from ..models import User, Grade, WeeklyReport, ReportComment

router = APIRouter(prefix="/api/reports", tags=["reports"])


def current_week() -> str:
    y, w, _ = date.today().isocalendar()
    return f"{y}-W{w:02d}"


def recent_weeks(n: int = 12) -> list[str]:
    today = date.today()
    monday = today - timedelta(days=today.weekday())
    weeks = []
    for i in range(n):
        d = monday - timedelta(weeks=i)
        y, w, _ = d.isocalendar()
        weeks.append(f"{y}-W{w:02d}")
    return weeks


def report_view(r: WeeklyReport, session: Session) -> dict:
    stu = session.get(User, r.student_id)
    comments = session.exec(
        select(ReportComment).where(ReportComment.report_id == r.id).order_by(ReportComment.created_at)
    ).all()
    return {
        "id": r.id, "student_id": r.student_id,
        "student_name": stu.name if stu else "?",
        "student_no": stu.student_no if stu else "",
        "grade_id": stu.grade_id if stu else None,
        "week": r.week, "content_md": r.content_md,
        "created_at": r.created_at, "updated_at": r.updated_at,
        "comments": [
            {
                "id": c.id, "content": c.content, "created_at": c.created_at,
                "author_name": (session.get(User, c.author_id) or User(name="?", username="", password_hash="")).name,
            }
            for c in comments
        ],
    }


@router.get("/weeks")
def list_weeks(user: User = Depends(get_current_user)):
    return {"current": current_week(), "weeks": recent_weeks(12)}


class ReportIn(BaseModel):
    content_md: str


@router.get("/my")
def my_reports(session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    reports = session.exec(
        select(WeeklyReport).where(WeeklyReport.student_id == user.id).order_by(WeeklyReport.week.desc())
    ).all()
    return [report_view(r, session) for r in reports]


@router.post("/my/{week}")
def upsert_my_report(week: str, data: ReportIn, session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    r = session.exec(
        select(WeeklyReport).where(WeeklyReport.student_id == user.id, WeeklyReport.week == week)
    ).first()
    if r:
        r.content_md = data.content_md
        r.updated_at = datetime.utcnow()
    else:
        r = WeeklyReport(student_id=user.id, week=week, content_md=data.content_md)
    session.add(r)
    session.commit()
    session.refresh(r)
    return report_view(r, session)


@router.get("/board")
def board(week: str | None = None, session: Session = Depends(get_session), teacher: User = Depends(require_teacher)):
    """老师视角：某一周所有学生的提交情况（含未交/逾期标记）"""
    week = week or current_week()
    students = session.exec(select(User).where(User.role == "student")).all()
    reports = session.exec(select(WeeklyReport).where(WeeklyReport.week == week)).all()
    by_student = {r.student_id: r for r in reports}
    y, w = week.split("-W")
    week_start = date.fromisocalendar(int(y), int(w), 1)
    deadline = week_start + timedelta(days=6)  # 周日截止
    result = []
    for s in students:
        grade = session.get(Grade, s.grade_id) if s.grade_id else None
        r = by_student.get(s.id)
        status = "已交" if r else ("逾期" if date.today() > deadline else "未交")
        item = {
            "student_id": s.id, "student_name": s.name, "student_no": s.student_no,
            "grade_name": grade.name if grade else "未分组",
            "status": status, "report": report_view(r, session) if r else None,
        }
        result.append(item)
    return {"week": week, "deadline": str(deadline), "items": result}


@router.get("/student/{sid}")
def student_reports(sid: int, session: Session = Depends(get_session), teacher: User = Depends(require_teacher)):
    reports = session.exec(
        select(WeeklyReport).where(WeeklyReport.student_id == sid).order_by(WeeklyReport.week.desc())
    ).all()
    return [report_view(r, session) for r in reports]


class CommentIn(BaseModel):
    content: str


@router.post("/{rid}/comments")
def add_comment(rid: int, data: CommentIn, session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    r = session.get(WeeklyReport, rid)
    if not r:
        raise HTTPException(404, "周报不存在")
    if user.role != "teacher" and r.student_id != user.id:
        raise HTTPException(403, "无权评论")
    c = ReportComment(report_id=rid, author_id=user.id, content=data.content)
    session.add(c)
    session.commit()
    return report_view(r, session)
