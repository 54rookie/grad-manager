from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from ..auth import get_current_user, require_teacher
from ..database import get_session
from ..models import User, Grade

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
    session.delete(u)
    session.commit()
    return {"ok": True}
