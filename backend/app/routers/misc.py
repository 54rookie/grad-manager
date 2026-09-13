from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from ..auth import get_current_user, require_teacher
from ..database import get_session
from ..models import User, Question, Reply, Announcement, Link

router = APIRouter(prefix="/api", tags=["misc"])


# ---------- 问答点评 ----------

class QuestionIn(BaseModel):
    content: str


class ReplyIn(BaseModel):
    content: str


def question_view(q: Question, session: Session) -> dict:
    author = session.get(User, q.author_id)
    replies = session.exec(
        select(Reply).where(Reply.question_id == q.id).order_by(Reply.created_at)
    ).all()
    return {
        "id": q.id, "content": q.content, "created_at": q.created_at,
        "author_name": author.name if author else "?",
        "author_role": author.role if author else "",
        "replies": [
            {
                "id": r.id, "content": r.content, "created_at": r.created_at,
                "author_name": (a.name if (a := session.get(User, r.author_id)) else "?"),
                "author_role": (a.role if (a := session.get(User, r.author_id)) else ""),
            }
            for r in replies
        ],
    }


@router.get("/questions")
def list_questions(session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    qs = session.exec(select(Question).order_by(Question.created_at.desc())).all()
    return [question_view(q, session) for q in qs]


@router.post("/questions")
def create_question(data: QuestionIn, session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    q = Question(author_id=user.id, content=data.content)
    session.add(q)
    session.commit()
    session.refresh(q)
    return question_view(q, session)


@router.post("/questions/{qid}/replies")
def add_reply(qid: int, data: ReplyIn, session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    q = session.get(Question, qid)
    if not q:
        raise HTTPException(404, "问题不存在")
    session.add(Reply(question_id=qid, author_id=user.id, content=data.content))
    session.commit()
    return question_view(q, session)


@router.delete("/questions/{qid}")
def delete_question(qid: int, session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    q = session.get(Question, qid)
    if not q:
        raise HTTPException(404, "问题不存在")
    if user.role != "teacher" and q.author_id != user.id:
        raise HTTPException(403, "无权删除")
    for r in session.exec(select(Reply).where(Reply.question_id == qid)).all():
        session.delete(r)
    session.delete(q)
    session.commit()
    return {"ok": True}


# ---------- 公告板 ----------

class AnnouncementIn(BaseModel):
    title: str
    content: str


@router.get("/announcements")
def list_announcements(session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    items = session.exec(select(Announcement).order_by(Announcement.created_at.desc())).all()
    return [
        {
            "id": a.id, "title": a.title, "content": a.content, "created_at": a.created_at,
            "author_name": (u.name if (u := session.get(User, a.author_id)) else "?"),
        }
        for a in items
    ]


@router.post("/announcements")
def create_announcement(data: AnnouncementIn, session: Session = Depends(get_session), teacher: User = Depends(require_teacher)):
    a = Announcement(author_id=teacher.id, title=data.title, content=data.content)
    session.add(a)
    session.commit()
    session.refresh(a)
    return a


@router.delete("/announcements/{aid}")
def delete_announcement(aid: int, session: Session = Depends(get_session), teacher: User = Depends(require_teacher)):
    a = session.get(Announcement, aid)
    if not a:
        raise HTTPException(404, "公告不存在")
    session.delete(a)
    session.commit()
    return {"ok": True}


# ---------- 超链接 ----------

class LinkIn(BaseModel):
    title: str
    url: str


@router.get("/links")
def list_links(session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    return session.exec(select(Link).order_by(Link.created_at.desc())).all()


@router.post("/links")
def create_link(data: LinkIn, session: Session = Depends(get_session), teacher: User = Depends(require_teacher)):
    link = Link(title=data.title, url=data.url, created_by=teacher.id)
    session.add(link)
    session.commit()
    session.refresh(link)
    return link


@router.delete("/links/{lid}")
def delete_link(lid: int, session: Session = Depends(get_session), teacher: User = Depends(require_teacher)):
    link = session.get(Link, lid)
    if not link:
        raise HTTPException(404, "链接不存在")
    session.delete(link)
    session.commit()
    return {"ok": True}
