from fastapi import APIRouter, Depends, HTTPException, File, Form, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlmodel import Session, select

from ..auth import get_current_user, require_teacher
from ..database import get_session
from ..models import User, Question, Reply, Announcement, AnnouncementAttachment, Link
from ..uploads import MAX_FILES, save_upload, delete_upload, upload_path

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


def announcement_view(a: Announcement, session: Session) -> dict:
    u = session.get(User, a.author_id)
    attachments = session.exec(select(AnnouncementAttachment).where(AnnouncementAttachment.announcement_id == a.id)).all()
    return {
        "id": a.id, "title": a.title, "content": a.content, "created_at": a.created_at,
        "author_name": u.name if u else "?",
        "attachments": [{"id": f.id, "name": f.original_name} for f in attachments],
    }


@router.get("/announcements")
def list_announcements(session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    items = session.exec(select(Announcement).order_by(Announcement.created_at.desc())).all()
    return [announcement_view(a, session) for a in items]


@router.post("/announcements")
def create_announcement(data: AnnouncementIn, session: Session = Depends(get_session), teacher: User = Depends(require_teacher)):
    a = Announcement(author_id=teacher.id, title=data.title, content=data.content)
    session.add(a)
    session.commit()
    session.refresh(a)
    return announcement_view(a, session)


@router.post("/announcements/with-attachments")
def create_announcement_with_attachments(title: str = Form(...), content: str = Form(...),
                                         files: list[UploadFile] = File(default=[]),
                                         session: Session = Depends(get_session),
                                         teacher: User = Depends(require_teacher)):
    if not title.strip() or not content.strip():
        raise HTTPException(400, "标题和内容不能为空")
    if len(files) > MAX_FILES:
        raise HTTPException(400, f"每条公告最多 {MAX_FILES} 个附件")
    saved = []
    try:
        for file in files:
            saved.append(save_upload(file))
        a = Announcement(author_id=teacher.id, title=title.strip(), content=content.strip())
        session.add(a)
        session.flush()
        for stored, name, mime in saved:
            session.add(AnnouncementAttachment(announcement_id=a.id, stored_name=stored,
                                               original_name=name, image_mime=mime))
        session.commit()
    except Exception:
        session.rollback()
        for stored, _, _ in saved:
            delete_upload(stored)
        raise
    session.refresh(a)
    return announcement_view(a, session)


@router.get("/announcements/attachments/{attachment_id}")
def announcement_attachment(attachment_id: int, session: Session = Depends(get_session),
                            user: User = Depends(get_current_user)):
    a = session.get(AnnouncementAttachment, attachment_id)
    if not a or not session.get(Announcement, a.announcement_id):
        raise HTTPException(404, "附件不存在")
    return FileResponse(upload_path(a.stored_name), media_type="application/octet-stream",
                        headers={"X-Content-Type-Options": "nosniff"})


@router.delete("/announcements/{aid}")
def delete_announcement(aid: int, session: Session = Depends(get_session), teacher: User = Depends(require_teacher)):
    a = session.get(Announcement, aid)
    if not a:
        raise HTTPException(404, "公告不存在")
    attachments = session.exec(select(AnnouncementAttachment).where(AnnouncementAttachment.announcement_id == aid)).all()
    for file in attachments:
        session.delete(file)
    session.delete(a)
    session.commit()
    for file in attachments:
        delete_upload(file.stored_name)
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
