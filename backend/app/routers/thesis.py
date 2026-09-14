import json
import re
import uuid
from datetime import datetime, date
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlmodel import Session, select

from ..auth import get_current_user, require_teacher
from ..database import get_session, UPLOAD_DIR
from ..models import (
    User, Grade, ThesisProject, ThesisRound, Setting,
    DEFAULT_MILESTONES, DEFAULT_RISK_CONFIG, RISK_LEVELS, RISK_CONFIG_KEY, RISK_TRACK_KEYS,
)

router = APIRouter(prefix="/api/thesis", tags=["thesis"])


def save_upload(f: UploadFile) -> tuple[str, str]:
    ext = Path(f.filename or "file").suffix
    stored = f"{uuid.uuid4().hex}{ext}"
    with open(UPLOAD_DIR / stored, "wb") as out:
        out.write(f.file.read())
    return stored, f.filename or stored


# ---------- 风险基准：按入学年份推算每个节点的「应该完成时间」 ----------

def _default_baselines() -> dict:
    return {k: dict(v) for k, v in DEFAULT_RISK_CONFIG["baselines"].items()}


def load_risk_config(session: Session) -> dict:
    """读风险基准配置；没存过就用默认值。与默认值做合并，方便以后加新节点。

    兼容上一版的**扁平结构**（`{"anchor_month":9,"offsets":{...}}`）：
    检测到没有 baselines 时，把旧的 offsets 当作 paper1 收进来，paper2 用默认值补
    —— 老师之前改过的 paper1 数值不会丢。幂等。
    """
    cfg = None
    row = session.get(Setting, RISK_CONFIG_KEY)
    if row and row.value:
        try:
            parsed = json.loads(row.value)
            if isinstance(parsed, dict):
                cfg = parsed
        except json.JSONDecodeError:
            cfg = None

    baselines = _default_baselines()
    if not cfg:
        return {"anchor_month": DEFAULT_RISK_CONFIG["anchor_month"], "baselines": baselines}

    stored = cfg.get("baselines")
    if isinstance(stored, dict):
        for key, vals in stored.items():
            if key in baselines and isinstance(vals, dict):
                baselines[key].update(vals)
    elif isinstance(cfg.get("offsets"), dict):
        # 旧版扁平结构 → 视为 paper1
        baselines["paper1"].update(cfg["offsets"])

    return {
        "anchor_month": int(cfg.get("anchor_month") or DEFAULT_RISK_CONFIG["anchor_month"]),
        "baselines": baselines,
    }


def _enroll_year(stu: User | None, grade: Grade | None) -> int | None:
    """入学年份：优先学号前 4 位（2024001 → 2024），回落到年级名里的「2024级」。"""
    if stu and stu.student_no:
        head = str(stu.student_no)[:4]
        if head.isdigit():
            return int(head)
    if grade and grade.name:
        m = re.search(r"(\d{4})", grade.name)
        if m:
            return int(m.group(1))
    return None


def _add_months(d: date, n: int) -> date:
    """日期加 n 个月，取当月 1 号（stdlib 没有 relativedelta，手算）。"""
    m = d.month - 1 + n
    return date(d.year + m // 12, m % 12 + 1, 1)


def _months_between(a: date, b: date) -> int:
    """b 相对 a 过去了多少个**整月**；b 早于 a 返回负数。"""
    months = (b.year - a.year) * 12 + (b.month - a.month)
    if b.day < a.day:
        months -= 1
    return months


def milestone_due(label: str, track: int, enroll_year: int | None, config: dict) -> date | None:
    """某节点对该学生的基准时间。

    基准是**按论文分轨**的：paper1 与 paper2 的心月份不同，
    所以必须带上 track 才能取对（两篇论文的时间点整体错开）。
    该节点没设期限、或拿不到入学年份，返回 None。
    """
    if enroll_year is None:
        return None
    track_key = RISK_TRACK_KEYS.get(int(track or 1), "paper1")
    offset = ((config.get("baselines") or {}).get(track_key) or {}).get(label)
    if offset is None:
        return None
    anchor = date(int(enroll_year), int(config.get("anchor_month") or 9), 1)
    return _add_months(anchor, int(offset))


def _node_risk(actual: date | None, due: date, today: date) -> str:
    """单个节点的风险等级。

    ⚠️ 「遥遥领先」只在「已完成且早于基准」时给。未完成但还没到期的只是
    「还没到期」，算进度正常 —— 否则刚入学的新生会全班显示遥遥领先。
    """
    if actual is not None:
        if actual < due:
            return "遥遥领先"
        delay = _months_between(due, actual)
    else:
        if today <= due:
            return "进度正常"
        delay = _months_between(due, today)
    if delay < 3:
        return "进度正常"
    if delay < 5:
        return "预警关注"
    return "严重滞后"


def _is_leading(ms: list) -> bool:
    """特殊规则：论文 1 的「已投稿」完成 且 论文 2 的「写论文」完成 → 直接算遥遥领先。

    这是「两篇都推进到关键节点就算领先」的经验判定，属于**提升**：
    命中时无视常规算出来的等级，直接返回遥遥领先。

    ⚠️ 只管 label（节点名），不管 track 之外的字段 —— 节点改名后就匹配不到了，
    和风险基准是同一套约定（见基准设置弹窗里的提示）。
    """
    def done(track: int, label: str) -> bool:
        return any(
            m.get("track", 1) == track and m.get("label") == label and m.get("actual")
            for m in ms if isinstance(m, dict)
        )
    return done(1, "已投稿") and done(2, "写论文")


def compute_risk(p: ThesisProject, stu: User | None, grade: Grade | None, config: dict) -> str:
    """取两条论文轨道里**最严重**的一级；一个节点都没设期限就返回进度正常。"""
    try:
        ms = json.loads(p.milestones_json or "[]")
    except json.JSONDecodeError:
        return "进度正常"
    # 特殊提升规则优先：命中就是遥遥领先，不再看常规判定
    if _is_leading(ms):
        return "遥遥领先"
    year = _enroll_year(stu, grade)
    today = date.today()
    worst = None
    for m in ms:
        # 每个节点用它**自己那条论文轨道**的基准
        due = milestone_due(m.get("label", ""), m.get("track", 1), year, config)
        if due is None:
            continue
        actual = None
        if m.get("actual"):
            try:
                actual = date.fromisoformat(m["actual"])
            except (ValueError, TypeError):
                actual = None
        idx = RISK_LEVELS.index(_node_risk(actual, due, today))
        worst = idx if worst is None else max(worst, idx)
    return RISK_LEVELS[worst] if worst is not None else "进度正常"


def project_view(p: ThesisProject, session: Session, config: dict | None = None) -> dict:
    stu = session.get(User, p.student_id)
    grade = session.get(Grade, stu.grade_id) if stu and stu.grade_id else None
    config = config or load_risk_config(session)
    year = _enroll_year(stu, grade)
    try:
        raw = json.loads(p.milestones_json or "[]")
    except json.JSONDecodeError:
        raw = []
    # 基准日期只在后端算一份，前端直接拿 due 显示，不重复实现日期推算
    milestones = []
    for m in raw:
        due = milestone_due(m.get("label", ""), m.get("track", 1), year, config)
        milestones.append({**m, "due": due.isoformat() if due else None})
    auto = compute_risk(p, stu, grade, config)
    return {
        "id": p.id,
        "student_id": p.student_id,
        "student_name": stu.name if stu else "?",
        "student_no": stu.student_no if stu else "",
        "grade_id": stu.grade_id if stu else None,
        "grade_name": grade.name if grade else "未分组",
        "enroll_year": year,
        "title": p.title,
        "stage": p.stage,
        "progress": p.progress,
        "milestones": milestones,
        # 老师手动指定优先；没指定才回落到自动判定
        "risk": p.risk_override or auto,
        "risk_auto": auto,
        "risk_override": p.risk_override,
    }


# ---------- 项目（进度） ----------

class ProjectIn(BaseModel):
    title: str | None = None
    stage: str | None = None
    progress: int | None = None
    milestones: list[dict] | None = None
    # 老师手动指定的风险等级；传空字符串表示清除覆盖、回到自动判定
    risk_override: str | None = None


# ---------- 风险基准配置（老师可改，改完全班风险立刻重算） ----------

class RiskConfigIn(BaseModel):
    anchor_month: int | None = None
    # {"paper1": {节点名: 月数 | null}, "paper2": {...}}；null 表示该节点不设期限
    baselines: dict[str, dict[str, int | None]] | None = None


@router.get("/risk-config")
def get_risk_config(session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    return load_risk_config(session)


@router.put("/risk-config")
def put_risk_config(data: RiskConfigIn, session: Session = Depends(get_session),
                    teacher: User = Depends(require_teacher)):
    """保存基准配置。风险是每次请求实时算的，所以下一次 GET /projects 就是新结果。"""
    current = load_risk_config(session)
    anchor = data.anchor_month if data.anchor_month is not None else current["anchor_month"]
    if not (1 <= int(anchor) <= 12):
        raise HTTPException(400, "基准月份必须在 1~12 之间")

    baselines = {k: dict(v) for k, v in current["baselines"].items()}
    if data.baselines:
        for track_key, vals in data.baselines.items():
            if track_key not in baselines:
                raise HTTPException(400, f"未知论文轨道：{track_key}")
            if not isinstance(vals, dict):
                raise HTTPException(400, f"{track_key} 必须是一个对象")
            for label, months in vals.items():
                if label not in baselines[track_key]:
                    raise HTTPException(400, f"未知节点：{label}")
                if months is None:
                    baselines[track_key][label] = None
                    continue
                m = int(months)
                if not (0 <= m <= 120):
                    raise HTTPException(400, f"「{label}」的偏移月数应在 0~120 之间")
                baselines[track_key][label] = m

    row = session.get(Setting, RISK_CONFIG_KEY) or Setting(key=RISK_CONFIG_KEY)
    row.value = json.dumps({"anchor_month": int(anchor), "baselines": baselines}, ensure_ascii=False)
    session.add(row)
    session.commit()
    return {"anchor_month": int(anchor), "baselines": baselines}


@router.get("/projects")
def list_projects(session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    """进度看板数据：老师与学生都能看到全班（只含看板公开字段）

    学生只能看，不能改；往返记录 / 周报是私密数据，另有接口单独鉴权。
    """
    # 配置只加载一次，循环复用 —— 否则每个项目都要查一次 Setting 表
    config = load_risk_config(session)
    projects = session.exec(select(ThesisProject)).all()
    return [project_view(p, session, config) for p in projects]


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
