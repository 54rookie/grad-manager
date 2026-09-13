"""定向消息：老师 → 学生的催办 / 提醒。

学生只读自己的收件箱；老师可发消息，也能看到自己发出的记录。
未读数用于 Banner 上的铃铛角标。
"""
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from ..auth import get_current_user, require_teacher
from ..database import get_session
from ..models import Message, User

router = APIRouter(prefix="/api/messages", tags=["messages"])

TOPICS = ["论文管理", "周报", "问答点评"]


def message_view(m: Message, session: Session) -> dict:
    frm = session.get(User, m.from_id)
    to = session.get(User, m.to_id)
    return {
        "id": m.id,
        "from_id": m.from_id,
        "from_name": frm.name if frm else "?",
        "to_id": m.to_id,
        "to_name": to.name if to else "?",
        "topic": m.topic,
        "content": m.content,
        "created_at": m.created_at,
        "read_at": m.read_at,
    }


class MessageIn(BaseModel):
    to_id: int
    topic: str = TOPICS[0]
    content: str = ""


@router.get("")
def my_messages(session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    """我的收件箱（老师看自己发出去的，学生看收到的）"""
    if user.role == "teacher":
        rows = session.exec(
            select(Message).where(Message.from_id == user.id).order_by(Message.created_at.desc())
        ).all()
    else:
        rows = session.exec(
            select(Message).where(Message.to_id == user.id).order_by(Message.created_at.desc())
        ).all()
    items = [message_view(m, session) for m in rows]
    # 未读只对「我收到的」有意义。老师看到的是自己发出的，未读数因此恒为 0；
    # 否则老师每发一条催办，自己的铃铛也会 +1。
    unread = sum(1 for i in items if i["to_id"] == user.id and not i["read_at"])
    return {"items": items, "unread": unread}


@router.post("")
def send_message(data: MessageIn, session: Session = Depends(get_session),
                 teacher: User = Depends(require_teacher)):
    target = session.get(User, data.to_id)
    if not target:
        raise HTTPException(404, "收件人不存在")
    if data.topic not in TOPICS:
        raise HTTPException(400, "话题不合法")
    if not data.content.strip():
        raise HTTPException(400, "消息内容不能为空")
    m = Message(from_id=teacher.id, to_id=data.to_id,
                topic=data.topic, content=data.content.strip())
    session.add(m)
    session.commit()
    session.refresh(m)
    return message_view(m, session)


@router.post("/read")
def mark_all_read(session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    """把「我收到的」全部标记为已读（学生点开消息中心时调用）"""
    rows = session.exec(
        select(Message).where(Message.to_id == user.id, Message.read_at == None)  # noqa: E711
    ).all()
    now = datetime.utcnow()
    for m in rows:
        m.read_at = now
        session.add(m)
    session.commit()
    return {"marked": len(rows)}
