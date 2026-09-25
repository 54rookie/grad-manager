from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import or_
from sqlmodel import Session, select

from ..auth import get_current_user, require_teacher
from ..database import get_session
from ..models import (
    User, Grade, ThesisProject, ReportAscension, ThesisRound, WeeklyReport, ReportAttachment,
    ReportComment, Question, Reply, Announcement, AnnouncementAttachment, Message, Link,
)
from ..uploads import delete_upload

router = APIRouter(prefix="/api", tags=["grades-users"])


class GradeIn(BaseModel):
    name: str


class UserIn(BaseModel):
    username: str
    password: str
    name: str
    role: str = "student"
    student_no: str | None = None
    grade_id: int | None = None


class UserUpdate(BaseModel):
    name: str | None = None
    student_no: str | None = None
    grade_id: int | None = None
    password: str | None = None


@router.get("/grades")
def list_grades(session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    return session.exec(select(Grade).order_by(Grade.name)).all()


@router.post("/grades")
def create_grade(data: GradeIn, session: Session = Depends(get_session), _: User = Depends(require_teacher)):
    if session.exec(select(Grade).where(Grade.name == data.name)).first():
        raise HTTPException(400, "年级已存在")
    g = Grade(name=data.name)
    session.add(g)
    session.commit()
    session.refresh(g)
    return g


@router.put("/grades/{gid}")
def update_grade(gid: int, data: GradeIn, session: Session = Depends(get_session), _: User = Depends(require_teacher)):
    g = session.get(Grade, gid)
    if not g:
        raise HTTPException(404, "年级不存在")
    g.name = data.name
    session.add(g)
    session.commit()
    return g


@router.delete("/grades/{gid}")
def delete_grade(gid: int, session: Session = Depends(get_session), _: User = Depends(require_teacher)):
    g = session.get(Grade, gid)
    if not g:
        raise HTTPException(404, "年级不存在")
    session.delete(g)
    session.commit()
    return {"ok": True}


@router.get("/users")
def list_users(role: str | None = None, session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    q = select(User)
    if role:
        q = q.where(User.role == role)
    users = session.exec(q.order_by(User.grade_id, User.student_no)).all()
    return [
        {
            "id": u.id, "username": u.username, "name": u.name, "role": u.role,
            "student_no": u.student_no, "grade_id": u.grade_id,
        }
        for u in users
    ]


@router.post("/users")
def create_user(data: UserIn, session: Session = Depends(get_session), _: User = Depends(require_teacher)):
    from ..auth import hash_password
    if session.exec(select(User).where(User.username == data.username)).first():
        raise HTTPException(400, "用户名已存在")
    u = User(
        username=data.username, password_hash=hash_password(data.password),
        name=data.name, role=data.role, student_no=data.student_no, grade_id=data.grade_id,
    )
    session.add(u)
    session.commit()
    session.refresh(u)
    return {"id": u.id, "username": u.username, "name": u.name, "role": u.role}


@router.put("/users/{uid}")
def update_user(uid: int, data: UserUpdate, session: Session = Depends(get_session), _: User = Depends(require_teacher)):
    from ..auth import hash_password
    u = session.get(User, uid)
    if not u:
        raise HTTPException(404, "用户不存在")
    if data.name is not None:
        u.name = data.name
    if data.student_no is not None:
        u.student_no = data.student_no
    if data.grade_id is not None:
        u.grade_id = data.grade_id
    if data.password:
        u.password_hash = hash_password(data.password)
    session.add(u)
    session.commit()
    return {"ok": True}


@router.delete("/users/{uid}")
def delete_user(uid: int, session: Session = Depends(get_session), _: User = Depends(require_teacher)):
    u = session.get(User, uid)
    if not u:
        raise HTTPException(404, "用户不存在")
    if u.role == "teacher" and session.exec(select(User.id).where(
        User.role == "teacher", User.id != uid
    )).first() is None:
        raise HTTPException(400, "不能删除最后一个老师账号")

    projects = session.exec(select(ThesisProject).where(ThesisProject.student_id == uid)).all()
    ascensions = session.exec(select(ReportAscension).where(ReportAscension.student_id == uid)).all()
    reports = session.exec(select(WeeklyReport).where(WeeklyReport.student_id == uid)).all()
    questions = session.exec(select(Question).where(Question.author_id == uid)).all()
    announcements = session.exec(select(Announcement).where(Announcement.author_id == uid)).all()

    rounds = session.exec(select(ThesisRound).where(ThesisRound.project_id.in_([p.id for p in projects]))).all()
    report_files = session.exec(select(ReportAttachment).where(ReportAttachment.report_id.in_([r.id for r in reports]))).all()
    comments = session.exec(select(ReportComment).where(or_(
        ReportComment.author_id == uid, ReportComment.report_id.in_([r.id for r in reports])
    ))).all()
    replies = session.exec(select(Reply).where(or_(
        Reply.author_id == uid, Reply.question_id.in_([q.id for q in questions])
    ))).all()
    announcement_files = session.exec(select(AnnouncementAttachment).where(
        AnnouncementAttachment.announcement_id.in_([a.id for a in announcements])
    )).all()
    messages = session.exec(select(Message).where(or_(Message.from_id == uid, Message.to_id == uid))).all()
    links = session.exec(select(Link).where(Link.created_by == uid)).all()

    stored_files = {
        name for r in rounds for name in (r.student_file, r.teacher_file) if name
    } | {a.stored_name for a in report_files} | {a.stored_name for a in announcement_files}

    try:
        for row in (*rounds, *ascensions, *report_files, *comments, *replies, *announcement_files, *messages, *links):
            session.delete(row)
        session.flush()
        for row in (*projects, *reports, *questions, *announcements):
            session.delete(row)
        session.flush()
        session.delete(u)
        session.commit()
    except Exception:
        session.rollback()
        raise
    for stored in stored_files:
        delete_upload(stored)
    return {"ok": True}
