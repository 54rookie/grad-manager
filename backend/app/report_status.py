"""由论文基础节点推导周报免交起始周，不存冗余状态。"""

import json
from datetime import date, timedelta

from sqlmodel import Session, select

from .models import ThesisProject, ReportAscension


ADVANCED_MILESTONE_LABELS = {"修论文", "中论文"}


def ascended_from_week(project: ThesisProject | None) -> str | None:
    """基础节点全部完成时，从最后一个基础节点完成的那周起免交。"""
    if not project:
        return None
    try:
        nodes = json.loads(project.milestones_json or "[]")
    except (TypeError, ValueError):
        return None
    if not isinstance(nodes, list):
        return None
    base = [node for node in nodes if isinstance(node, dict)
            and node.get("label") not in ADVANCED_MILESTONE_LABELS]
    # Progress.jsx 在项目视图中把 done 统一映射成 !!actual，故这里也以 actual 为准。
    if not base or any(not node.get("actual") for node in base):
        return None
    completed_dates = []
    for node in base:
        try:
            completed_dates.append(date.fromisoformat(node["actual"]))
        except (TypeError, ValueError):
            # 实际日期格式异常时仍视为已完成，但无法还原历史，从本周免交。
            today = date.today()
            y, w, _ = today.isocalendar()
            return f"{y}-W{w:02d}"
    # 实际完成日被误填到未来时，100% 的当前周也必须立即免交。
    y, w, _ = min(max(completed_dates), date.today()).isocalendar()
    return f"{y}-W{w:02d}"


def _week_of(day: date) -> str:
    year, week, _ = day.isocalendar()
    return f"{year}-W{week:02d}"


def ascension_windows(project: ThesisProject | None, session: Session,
                      rows: list[ReportAscension] | None = None) -> list[dict]:
    """返回该学生历史免交区间；旧项目没有区间时从节点日期推定。"""
    if not project:
        return []
    if rows is None:
        rows = session.exec(select(ReportAscension).where(
            ReportAscension.student_id == project.student_id
        )).all()
    since = ascended_from_week(project)
    if rows:
        windows = [{"start_week": row.start_week, "end_week": row.end_week} for row in rows]
        open_windows = [window for window in windows if window["end_week"] is None]
        if since and not is_ascended_on(windows, _week_of(date.today())):
            # 旧区间已结束或错误地从未来才开始时，当前 100% 仍须立即生效。
            windows.append({"start_week": _week_of(date.today()), "end_week": None})
        elif not since and open_windows:
            previous_week = _week_of(date.today() - timedelta(days=date.today().weekday() + 1))
            windows = [window for window in windows if window["end_week"] is not None
                       or window["start_week"] <= previous_week]
            for window in windows:
                if window["end_week"] is None:
                    window["end_week"] = previous_week
        return windows
    return [{"start_week": since, "end_week": None}] if since else []


def is_ascended_on(windows: list[dict], week: str) -> bool:
    return any(window["start_week"] <= week and (
        window["end_week"] is None or week <= window["end_week"]
    ) for window in windows)


def record_ascension_change(session: Session, project: ThesisProject,
                            was_ascended_since: str | None) -> None:
    """在项目节点变更的同一事务中记录升/降；不改周报及已有区间。"""
    now_ascended = ascended_from_week(project) is not None
    was_ascended = was_ascended_since is not None
    if was_ascended == now_ascended:
        return
    rows = session.exec(select(ReportAscension).where(
        ReportAscension.student_id == project.student_id
    )).all()
    if now_ascended:
        session.add(ReportAscension(student_id=project.student_id, start_week=_week_of(date.today())))
        return
    previous_week = _week_of(date.today() - timedelta(days=date.today().weekday() + 1))
    open_row = next((row for row in rows if row.end_week is None), None)
    if open_row:
        if open_row.start_week <= previous_week:
            open_row.end_week = previous_week
            session.add(open_row)
        else:
            session.delete(open_row)  # 同周升降，没有历史免交周
    elif was_ascended_since <= previous_week:
        # 老项目首次降回 100% 以下：先把节点日期推定出的历史区间封存。
        session.add(ReportAscension(student_id=project.student_id,
                                    start_week=was_ascended_since, end_week=previous_week))
