import json
import re
from datetime import datetime, date, timedelta

from fastapi import APIRouter, Depends, HTTPException, File, Form, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlmodel import Session, select

from ..auth import get_current_user, require_teacher
from ..database import get_session
from ..models import User, Grade, ThesisProject, ReportAscension, WeeklyReport, ReportComment, ReportAttachment, Setting, SEMESTER_CONFIG_KEY
from ..report_status import ascension_windows, is_ascended_on
from ..uploads import MAX_FILES, save_upload, delete_upload, upload_path

router = APIRouter(prefix="/api/reports", tags=["reports"])

DEFAULT_REPORT_TEMPLATE = "## 本周进展\n- …\n\n## 遇到问题\n- …\n\n## 下周计划\n- …"
REPORT_TEMPLATE_KEY = "report_template"


def current_week() -> str:
    y, w, _ = date.today().isocalendar()
    return f"{y}-W{w:02d}"


# ============================================================
# 学期 / 起始周
#
# 周报在库里始终以 ISO 周（2026-W37）为主键，学期与「第几周」都是**派生**出来的：
#   · 学期   —— 由日期推算：秋季 = 8 月 ~ 次年 1 月，春季 = 2 月 ~ 7 月
#   · 第 N 周 —— 由老师设定的「学期基准周」往后数
# 这样老师改基准周只是换个显示口径，不会动到任何历史数据。
# ============================================================

SEMESTER_RE = re.compile(r"^\d{4}-(spring|autumn)$")
WEEK_RE = re.compile(r"^\d{4}-W\d{2}$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def monday_of(week: str) -> date:
    """ISO 周字符串 → 该周周一。"""
    y, w = week.split("-W")
    return date.fromisocalendar(int(y), int(w), 1)


def sunday_of(week: str) -> date:
    """ISO 周字符串 → 该周周日（基准周对外就用这个日期表达）。"""
    return monday_of(week) + timedelta(days=6)


def week_key(d: date) -> str:
    y, w, _ = d.isocalendar()
    return f"{y}-W{w:02d}"


def semester_of(d: date) -> str:
    """日期 → 学期 key。秋季用**起始年**做年份（2026-autumn 覆盖 2026-08 ~ 2027-01）。"""
    if d.month >= 8:
        return f"{d.year}-autumn"
    if d.month == 1:
        return f"{d.year - 1}-autumn"
    return f"{d.year}-spring"


def semester_bounds(key: str) -> tuple[date, date]:
    y = int(key.split("-")[0])
    if key.endswith("autumn"):
        return date(y, 8, 1), date(y + 1, 1, 31)
    return date(y, 2, 1), date(y, 7, 31)


def semester_label(key: str) -> str:
    y, term = key.split("-")
    return f"{y} 秋季学期" if term == "autumn" else f"{y} 春季学期"


def first_monday_of_semester(key: str) -> date:
    """学期第一周 —— 学期起始日当天或之后的第一个周一。"""
    start, _ = semester_bounds(key)
    return start + timedelta(days=(7 - start.weekday()) % 7)


def semester_weeks(key: str) -> list[str]:
    """该学期覆盖的全部 ISO 周，**升序**（第 1 周在最前）。"""
    _, end = semester_bounds(key)
    out, d = [], first_monday_of_semester(key)
    while d <= end and len(out) < 60:
        out.append(week_key(d))
        d += timedelta(weeks=1)
    return out


def next_semester(key: str) -> str:
    y, term = key.split("-")
    return f"{y}-autumn" if term == "spring" else f"{int(y) + 1}-spring"


def semester_keys_between(d0: date, d1: date) -> list[str]:
    """从 d0 所在学期数到 d1 所在学期（升序）。"""
    cur, last = semester_of(d0), semester_of(d1)
    out = []
    for _ in range(60):
        out.append(cur)
        if cur == last:
            break
        cur = next_semester(cur)
    return out


def load_semester_config(session: Session) -> dict:
    """读学期基准周配置：{"start_weeks": {"2026-autumn": "2026-W37"}}"""
    row = session.get(Setting, SEMESTER_CONFIG_KEY)
    if row and row.value:
        try:
            parsed = json.loads(row.value)
            if isinstance(parsed, dict) and isinstance(parsed.get("start_weeks"), dict):
                return {
                    "start_weeks": {
                        k: v for k, v in parsed["start_weeks"].items()
                        if isinstance(v, str) and SEMESTER_RE.match(str(k))
                    }
                }
        except json.JSONDecodeError:
            pass
    return {"start_weeks": {}}


def start_week_of(session: Session, sem: str) -> tuple[str, bool]:
    """某学期的「第 1 周」→ (ISO 周, 是否老师自定义)。

    只有老师设过的周确实落在该学期周次范围内才认，否则回落到学期默认值
    （这样即使配置是别的学期留下的，也不会算出第 0 周 / 负数周）。
    """
    custom = load_semester_config(session)["start_weeks"].get(sem)
    if custom and custom in set(semester_weeks(sem)):
        return custom, True
    return week_key(first_monday_of_semester(sem)), False


def available_semesters(session: Session) -> list[str]:
    """可选学期列表：从「最早有数据的周 / 配置周 / 12 周前」一路到现在，最新在前。"""
    today = date.today()
    points = [today - timedelta(weeks=12), today]
    for w in session.exec(select(WeeklyReport.week)).all():
        if isinstance(w, str) and WEEK_RE.match(w):
            points.append(monday_of(w))
    for w in load_semester_config(session)["start_weeks"].values():
        if WEEK_RE.match(w):
            points.append(monday_of(w))
    return list(reversed(semester_keys_between(min(points), max(points))))


def report_view(r: WeeklyReport, session: Session) -> dict:
    stu = session.get(User, r.student_id)
    comments = session.exec(
        select(ReportComment).where(ReportComment.report_id == r.id).order_by(ReportComment.created_at)
    ).all()
    attachments = session.exec(select(ReportAttachment).where(ReportAttachment.report_id == r.id)).all()
    return {
        "id": r.id, "student_id": r.student_id,
        "student_name": stu.name if stu else "?",
        "student_no": stu.student_no if stu else "",
        "grade_id": stu.grade_id if stu else None,
        "week": r.week, "content_md": r.content_md,
        "attachments": [{"id": a.id, "name": a.original_name, "is_image": bool(a.image_mime)} for a in attachments],
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
def list_weeks(semester: str | None = None, session: Session = Depends(get_session),
               user: User = Depends(get_current_user)):
    """周次元数据：学期列表 + 该学期的周次 + 每周是「第几周」。

    学生也要拉这个接口（他自己的周报也是按周次看的），所以不限制角色。
    """
    today = date.today()
    cur = current_week()
    today_sem = semester_of(today)

    keys = available_semesters(session)
    sem = semester if semester and SEMESTER_RE.match(semester) and semester in keys else today_sem
    if sem not in keys:
        keys = [sem, *keys]

    weeks = semester_weeks(sem)
    start_week, custom = start_week_of(session, sem)
    base = monday_of(start_week)
    # 第几周：以基准周为第 1 周往后数；基准周之前的周次会算成 0 或负数，前端只显示正数
    week_index = {w: (monday_of(w) - base).days // 7 + 1 for w in weeks}

    # 默认选中：本周在本学期内就选本周，否则选该学期里「已经开了头」的最后一周
    if cur in weeks:
        default_week = cur
    else:
        started = [w for w in weeks if monday_of(w) <= today]
        default_week = started[-1] if started else weeks[0]

    project = session.exec(select(ThesisProject).where(
        ThesisProject.student_id == user.id
    )).first() if user.role == "student" else None
    exemption_windows = ascension_windows(project, session)

    return {
        "current": cur,
        "weeks": weeks,
        "week_index": week_index,
        "semester": sem,
        "semester_label": semester_label(sem),
        "semesters": [{"key": k, "label": semester_label(k)} for k in keys],
        "start_week": start_week,
        "start_date": sunday_of(start_week).isoformat(),
        "start_week_custom": custom,
        "default_week": default_week,
        "ascended_from_week": next((w["start_week"] for w in exemption_windows if w["end_week"] is None), None),
        "ascension_windows": exemption_windows,
    }


class ReportIn(BaseModel):
    content_md: str


class ReportTemplateIn(BaseModel):
    template: str


@router.get("/template")
def get_report_template(session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    row = session.get(Setting, REPORT_TEMPLATE_KEY)
    return {"template": row.value if row else DEFAULT_REPORT_TEMPLATE}


@router.put("/template")
def put_report_template(data: ReportTemplateIn, session: Session = Depends(get_session),
                        teacher: User = Depends(require_teacher)):
    if not data.template.strip() or len(data.template) > 4000:
        raise HTTPException(400, "周报示例须为 1 至 4000 字")
    row = session.get(Setting, REPORT_TEMPLATE_KEY) or Setting(key=REPORT_TEMPLATE_KEY)
    row.value = data.template
    session.add(row)
    session.commit()
    return {"template": row.value}


class SemesterConfigIn(BaseModel):
    semester: str
    # 基准周的周日（YYYY-MM-DD）。对外用日期表达，库里仍折算成 ISO 周来算。
    start_date: str


@router.get("/semester-config")
def get_semester_config(session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    """当前学期的基准周（学生只读，用于显示「第 N 周」）。"""
    sem = semester_of(date.today())
    start_week, custom = start_week_of(session, sem)
    return {
        "semester": sem,
        "start_week": start_week,
        "start_date": sunday_of(start_week).isoformat(),
        "custom": custom,
        "start_weeks": load_semester_config(session)["start_weeks"],
    }


@router.put("/semester-config")
def put_semester_config(data: SemesterConfigIn, session: Session = Depends(get_session),
                        teacher: User = Depends(require_teacher)):
    """老师端设置「哪一周是第一周」。

    入参是日期而不是 ISO 周：老师直接选一个**周日**，该周日所在的那一周即第 1 周。
    校验三层：格式 → 必须是周日 → 必须落在该学期的周次范围内。
    """
    if not SEMESTER_RE.match(data.semester or ""):
        raise HTTPException(400, "学期格式不正确")
    if not DATE_RE.match(data.start_date or ""):
        raise HTTPException(400, "日期格式不正确，应形如 2026-09-06")
    try:
        d = date.fromisoformat(data.start_date)
    except ValueError:
        raise HTTPException(400, "日期格式不正确，应形如 2026-09-06")
    if d.weekday() != 6:
        raise HTTPException(400, "基准周只能选周日的日期")

    weeks = semester_weeks(data.semester)
    week = week_key(d)
    if week not in weeks:
        raise HTTPException(
            400, f"{data.start_date} 不在「{semester_label(data.semester)}」的周次范围内（"
                 f"{sunday_of(weeks[0]).isoformat()} ~ {sunday_of(weeks[-1]).isoformat()}）"
        )

    cfg = load_semester_config(session)
    cfg["start_weeks"][data.semester] = week
    row = session.get(Setting, SEMESTER_CONFIG_KEY) or Setting(key=SEMESTER_CONFIG_KEY)
    row.value = json.dumps(cfg, ensure_ascii=False)
    session.add(row)
    session.commit()

    start_week, custom = start_week_of(session, data.semester)
    return {
        "semester": data.semester,
        "start_week": start_week,
        "start_date": sunday_of(start_week).isoformat(),
        "custom": custom,
        "start_weeks": cfg["start_weeks"],
    }


@router.get("/my")
def my_reports(session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    reports = session.exec(
        select(WeeklyReport).where(WeeklyReport.student_id == user.id).order_by(WeeklyReport.week.desc())
    ).all()
    return [report_view(r, session) for r in reports]


@router.post("/my/{week}")
def upsert_my_report(week: str, data: ReportIn, session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    if user.role != "student" or week != current_week():
        raise HTTPException(403, "只能提交自己的本周周报")
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


@router.post("/my/{week}/submit")
def submit_my_report(week: str, content_md: str = Form(...), keep_ids: str = Form("[]"),
                     file_keys: str = Form("[]"), files: list[UploadFile] = File(default=[]),
                     session: Session = Depends(get_session),
                     user: User = Depends(get_current_user)):
    if user.role != "student" or week != current_week():
        raise HTTPException(403, "只能提交自己的本周周报")
    if not content_md.strip():
        raise HTTPException(400, "周报内容不能为空")
    r = session.exec(select(WeeklyReport).where(WeeklyReport.student_id == user.id, WeeklyReport.week == week)).first()
    existing = session.exec(select(ReportAttachment).where(ReportAttachment.report_id == r.id)).all() if r else []
    try:
        keep_list = json.loads(keep_ids)
        if not isinstance(keep_list, list) or not all(type(i) is int for i in keep_list):
            raise ValueError()
        keep = set(keep_list)
    except (ValueError, TypeError):
        raise HTTPException(400, "附件列表格式错误")
    if not keep.issubset({a.id for a in existing}):
        raise HTTPException(400, "附件列表包含无效文件")
    try:
        keys = json.loads(file_keys)
        if (not isinstance(keys, list) or len(keys) != len(files)
                or len(set(keys)) != len(keys)
                or not all(isinstance(key, str) and re.fullmatch(r"[a-z0-9-]{1,64}", key) for key in keys)):
            raise ValueError()
    except (ValueError, TypeError):
        raise HTTPException(400, "新附件标识格式错误")
    if len(keep) + len(files) > MAX_FILES:
        raise HTTPException(400, f"每份周报最多 {MAX_FILES} 个附件")
    saved = []
    try:
        for file in files:
            saved.append(save_upload(file))
        if not r:
            r = WeeklyReport(student_id=user.id, week=week)
        r.content_md = content_md
        r.updated_at = datetime.utcnow()
        session.add(r)
        session.flush()
        removed = [a for a in existing if a.id not in keep]
        for a in removed:
            session.delete(a)
        for key, (stored, name, mime) in zip(keys, saved):
            attachment = ReportAttachment(report_id=r.id, stored_name=stored, original_name=name, image_mime=mime)
            session.add(attachment)
            session.flush()
            marker = f"attachment:pending-{key})"
            if marker in r.content_md:
                if not mime:
                    raise HTTPException(400, f"「{name}」不是可插入正文的图片")
                r.content_md = r.content_md.replace(marker, f"attachment:{attachment.id})")
        if re.search(r"attachment:pending-[a-z0-9-]+", r.content_md):
            raise HTTPException(400, "正文中有未上传的图片")
        session.commit()
    except Exception:
        session.rollback()
        for stored, _, _ in saved:
            delete_upload(stored)
        raise
    for a in removed:
        delete_upload(a.stored_name)
    session.refresh(r)
    return report_view(r, session)


@router.get("/attachments/{attachment_id}")
def report_attachment(attachment_id: int, session: Session = Depends(get_session),
                      user: User = Depends(get_current_user)):
    a = session.get(ReportAttachment, attachment_id)
    r = session.get(WeeklyReport, a.report_id) if a else None
    if not r:
        raise HTTPException(404, "附件不存在")
    if user.role != "teacher" and r.student_id != user.id:
        raise HTTPException(403, "无权查看该附件")
    return FileResponse(upload_path(a.stored_name), media_type=a.image_mime or "application/octet-stream",
                        headers={"X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'"})


@router.get("/board")
def board(week: str | None = None, session: Session = Depends(get_session), teacher: User = Depends(require_teacher)):
    """老师视角：某一周所有学生的提交情况（含已飞升/未交/逾期标记）。"""
    week = week or current_week()
    students = session.exec(select(User).where(User.role == "student")).all()
    reports = session.exec(select(WeeklyReport).where(WeeklyReport.week == week)).all()
    projects = session.exec(select(ThesisProject)).all()
    exemption_rows = session.exec(select(ReportAscension)).all()
    by_student = {r.student_id: r for r in reports}
    rows_by_student = {}
    for row in exemption_rows:
        rows_by_student.setdefault(row.student_id, []).append(row)
    ascended = {p.student_id: ascension_windows(p, session, rows_by_student.get(p.student_id, []))
                for p in projects}
    y, w = week.split("-W")
    week_start = date.fromisocalendar(int(y), int(w), 1)
    deadline = week_start + timedelta(days=6)  # 周日截止
    result = []
    for s in students:
        grade = session.get(Grade, s.grade_id) if s.grade_id else None
        r = by_student.get(s.id)
        status = "已飞升" if is_ascended_on(ascended.get(s.id, []), week) else (
            "已交" if r else ("逾期" if date.today() > deadline else "未交")
        )
        item = {
            "student_id": s.id, "student_name": s.name, "student_no": s.student_no,
            "grade_name": grade.name if grade else "未分组",
            "status": status, "report": report_view(r, session) if r else None,
        }
        result.append(item)
    return {"week": week, "deadline": str(deadline), "items": result}


def _submission_rate(submitted: int, required: int, population: int) -> int:
    """全员免交算完成；无学生或尚无开始周时显示 0。"""
    return (submitted * 200 + required) // (required * 2) if required else (100 if population else 0)


@router.get("/semester-stats")
def semester_stats(semester: str | None = None, session: Session = Depends(get_session),
                   teacher: User = Depends(require_teacher)):
    """老师端统计：一次批量读取学期内的提交与免交区间。"""
    meta = list_weeks(semester=semester, session=session, user=teacher)
    selected = meta["semester"]
    started = [w for w in meta["weeks"] if w >= meta["start_week"] and monday_of(w) <= date.today()]
    this_week = current_week()
    students = session.exec(select(User).where(User.role == "student")).all()
    grades = {g.id: g.name for g in session.exec(select(Grade)).all()}
    projects = {p.student_id: p for p in session.exec(select(ThesisProject)).all()}
    rows_by_student = {}
    for row in session.exec(select(ReportAscension)).all():
        rows_by_student.setdefault(row.student_id, []).append(row)
    windows = {s.id: ascension_windows(projects.get(s.id), session, rows_by_student.get(s.id, []))
               for s in students}
    wanted = set(started) | {this_week}
    submitted_weeks = set(session.exec(select(WeeklyReport.student_id, WeeklyReport.week).where(
        WeeklyReport.week.in_(wanted)
    )).all())

    def blank():
        return {"required": 0, "submitted": 0, "missing": 0, "overdue": 0, "ascended": 0}

    def add_status(counts, student_id, week):
        if is_ascended_on(windows[student_id], week):
            counts["ascended"] += 1
        else:
            counts["required"] += 1
            if (student_id, week) in submitted_weeks:
                counts["submitted"] += 1
            elif date.today() > sunday_of(week):
                counts["overdue"] += 1
            else:
                counts["missing"] += 1

    students_out = [{"student_id": s.id, "student_name": s.name, "student_no": s.student_no,
                     "grade_name": grades.get(s.grade_id, "未分组"), **blank()}
                    for s in students]
    by_student = {item["student_id"]: item for item in students_out}
    weeks_out = []
    totals = blank()
    for week in started:
        counts = blank()
        for s in students:
            add_status(counts, s.id, week)
            add_status(by_student[s.id], s.id, week)
        for key in totals:
            totals[key] += counts[key]
        weeks_out.append({"week": week, **counts,
                          "rate": _submission_rate(counts["submitted"], counts["required"], len(students))})
    for item in students_out:
        item["rate"] = _submission_rate(item["submitted"], item["required"], len(started))
    totals["rate"] = _submission_rate(totals["submitted"], totals["required"],
                                      len(students) * len(started))
    current_counts = blank()
    for s in students:
        add_status(current_counts, s.id, this_week)
    return {
        "semester": selected,
        "student_count": len(students), "week_count": len(started),
        "students": students_out, "weeks": weeks_out,
        "totals": totals,
        "current_week": {"week": this_week, **current_counts,
                         "rate": _submission_rate(current_counts["submitted"],
                                                  current_counts["required"], len(students))},
    }


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
