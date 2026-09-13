import json
import uuid
from datetime import datetime, date
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlmodel import Session, select

from ..auth import get_current_user, require_teacher
from ..database import get_session, UPLOAD_DIR
from ..models import User, Grade, ThesisProject, ThesisRound, DEFAULT_MILESTONES

router = APIRouter(prefix="/api/thesis", tags=["thesis"])


def save_upload(f: UploadFile) -> tuple[str, str]:
    ext = Path(f.filename or "file").suffix
    stored = f"{uuid.uuid4().hex}{ext}"
    with open(UPLOAD_DIR / stored, "wb") as out:
        out.write(f.file.read())
    return stored, f.filename or stored


def compute_risk(p: ThesisProject) -> str:
    """正常 / 预警 / 滞后：按计划时间与实际时间判断"""
    try:
        ms = json.loads(p.milestones_json or "[]")
    except json.JSONDecodeError:
        return "正常"
    today = date.today()
    overdue = 0
    for m in ms:
        if m.get("plan") and not m.get("actual"):
            try:
                plan_d = date.fromisoformat(m["plan"])
            except ValueError:
                continue
            delay = (today - plan_d).days
            if delay > 14:
                return "滞后"
            if delay > 0:
                overdue += 1
    return "预警" if overdue else "正常"


def project_view(p: ThesisProject, session: Session) -> dict:
    stu = session.get(User, p.student_id)
    grade = session.get(Grade, stu.grade_id) if stu and stu.grade_id else None
    auto = compute_risk(p)  # 按 milestones 实时算出来的自动判定
    return {
        "id": p.id,
        "student_id": p.student_id,
        "student_name": stu.name if stu else "?",
        "student_no": stu.student_no if stu else "",
        "grade_id": stu.grade_id if stu else None,
        "grade_name": grade.name if grade else "未分组",
        "title": p.title,
        "stage": p.stage,
        "progress": p.progress,
        "milestones": json.loads(p.milestones_json or "[]"),
        # 老师手动指定优先；没指定才回落到自动判定
        "risk": p.risk_override or auto,
        "risk_auto": auto,
        "risk_override": p.risk_override,
    }


# ---------- 项目（进度） ----------

RISK_LEVELS = ["正常", "预警", "滞后"]


class ProjectIn(BaseModel):
    title: str | None = None
    stage: str | None = None
    progress: int | None = None
    milestones: list[dict] | None = None
    # 老师手动指定的风险等级；传空字符串表示清除覆盖、回到自动判定
    risk_override: str | None = None


@router.get("/projects")
def list_projects(session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    """进度看板数据：老师与学生都能看到全班（只含看板公开字段）

    学生只能看，不能改；往返记录 / 周报是私密数据，另有接口单独鉴权。
    """
    projects = session.exec(select(ThesisProject)).all()
    return [project_view(p, session) for p in projects]


@router.post("/projects/{student_id}")
def create_project(student_id: int, session: Session = Depends(get_session), teacher: User = Depends(require_teacher)):
    stu = session.get(User, student_id)
    if not stu or stu.role != "student":
        raise HTTPException(404, "学生不存在")
    if session.exec(select(ThesisProject).where(ThesisProject.student_id == student_id)).first():
        raise HTTPException(400, "该学生已有论文项目")
    p = ThesisProject(student_id=student_id, milestones_json=json.dumps(DEFAULT_MILESTONES, ensure_ascii=False))
    session.add(p)
    session.commit()
    session.refresh(p)
    return project_view(p, session)


@router.put("/projects/{pid}")
def update_project(pid: int, data: ProjectIn, session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    p = session.get(ThesisProject, pid)
    if not p:
        raise HTTPException(404, "项目不存在")
    # 学生只能改自己的题目；老师可改全部
    if user.role != "teacher":
        if p.student_id != user.id:
            raise HTTPException(403, "无权修改")
        if data.title is not None:
            p.title = data.title
    else:
        if data.title is not None:
            p.title = data.title
        if data.stage is not None:
            p.stage = data.stage
        if data.progress is not None:
            p.progress = max(0, min(100, data.progress))
        if data.milestones is not None:
            p.milestones_json = json.dumps(data.milestones, ensure_ascii=False)
        if data.risk_override is not None:
            # 空字符串 = 清除覆盖，回到 compute_risk() 的自动判定
            v = data.risk_override.strip()
            if not v:
                p.risk_override = None
            elif v in RISK_LEVELS:
                p.risk_override = v
            else:
                raise HTTPException(400, f"风险等级只能是 {'/'.join(RISK_LEVELS)}")
    session.add(p)
    session.commit()
    return project_view(p, session)


# ---------- 多轮提交 / 批注 ----------

@router.get("/projects/{pid}/rounds")
def list_rounds(pid: int, session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    p = session.get(ThesisProject, pid)
    if not p:
        raise HTTPException(404, "项目不存在")
    if user.role != "teacher" and p.student_id != user.id:
        raise HTTPException(403, "无权查看")
    rounds = session.exec(
        select(ThesisRound).where(ThesisRound.project_id == pid).order_by(ThesisRound.round_no)
    ).all()
    return rounds


@router.post("/projects/{pid}/rounds")
async def submit_round(
    pid: int,
    text: str = Form(""),
    file: UploadFile | None = File(None),
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    p = session.get(ThesisProject, pid)
    if not p or p.student_id != user.id:
        raise HTTPException(403, "无权提交")
    last = session.exec(
        select(ThesisRound).where(ThesisRound.project_id == pid).order_by(ThesisRound.round_no.desc())
    ).first()
    if last and not last.teacher_comment and not last.teacher_file:
        raise HTTPException(400, "上一轮尚未收到老师批注，请等待")
    stored = orig = None
    if file and file.filename:
        stored, orig = save_upload(file)
    r = ThesisRound(
        project_id=pid,
        round_no=(last.round_no + 1) if last else 1,
        student_text=text,
        student_file=stored,
        student_file_orig=orig,
    )
    session.add(r)
    session.commit()
    session.refresh(r)
    return r


@router.put("/rounds/{rid}")
async def update_round(
    rid: int,
    text: str = Form(""),
    file: UploadFile | None = File(None),
    keep_file: str = Form("1"),
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """学生修改本次提交（仅在老师批注之前允许）

    keep_file=0 表示删除原附件；上传新文件则替换原附件。
    """
    r = session.get(ThesisRound, rid)
    if not r:
        raise HTTPException(404, "记录不存在")
    p = session.get(ThesisProject, r.project_id)
    if not p or p.student_id != user.id:
        raise HTTPException(403, "无权修改")
    if r.teacher_comment or r.teacher_file:
        raise HTTPException(400, "老师已批注，不能再修改")
    r.student_text = text
    if file and file.filename:
        # 替换附件：删掉旧文件
        if r.student_file:
            old = UPLOAD_DIR / r.student_file
            if old.exists():
                old.unlink()
        r.student_file, r.student_file_orig = save_upload(file)
    elif keep_file == "0" and r.student_file:
        old = UPLOAD_DIR / r.student_file
        if old.exists():
            old.unlink()
        r.student_file = None
        r.student_file_orig = None
    session.add(r)
    session.commit()
    session.refresh(r)
    return r


@router.post("/rounds/{rid}/feedback")
async def feedback_round(
    rid: int,
    comment: str = Form(""),
    file: UploadFile | None = File(None),
    session: Session = Depends(get_session),
    teacher: User = Depends(require_teacher),
):
    r = session.get(ThesisRound, rid)
    if not r:
        raise HTTPException(404, "记录不存在")
    r.teacher_comment = comment
    if file and file.filename:
        r.teacher_file, r.teacher_file_orig = save_upload(file)
    r.feedback_at = datetime.utcnow()
    session.add(r)
    session.commit()
    session.refresh(r)
    return r


@router.get("/files/{stored_name}")
def download_file(stored_name: str, user: User = Depends(get_current_user)):
    path = UPLOAD_DIR / stored_name
    if not path.exists() or "/" in stored_name or ".." in stored_name:
        raise HTTPException(404, "文件不存在")
    return FileResponse(path)
