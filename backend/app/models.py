from datetime import datetime, date
from typing import Optional
from sqlmodel import SQLModel, Field


class User(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    username: str = Field(index=True, unique=True)
    password_hash: str
    name: str
    role: str = "student"  # student | teacher
    student_no: Optional[str] = None
    grade_id: Optional[int] = Field(default=None, foreign_key="grade.id")
    created_at: datetime = Field(default_factory=datetime.utcnow)


class Grade(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(index=True, unique=True)  # 例如 2024级


STAGES = ["开题", "初稿", "中期", "查重", "送审", "答辩", "完成"]

# 毕业要求两篇论文，所以每位学生有 2 条平行的进度轨道，每条 8 个节点。
# 里程碑在库里仍是一个**扁平数组**（形状不变，前端按 track 分组），
# 只是每项多了一个 track 字段，且总数从 6 变成 8×2=16。
MILESTONE_LABELS = ["学基础", "看论文", "出想法", "写论文", "改论文", "已投稿", "修论文", "中论文"]
PAPER_TRACKS = (1, 2)

DEFAULT_MILESTONES = [
    {"key": f"p{track}-{i}", "label": label, "track": track, "plan": None, "actual": None}
    for track in PAPER_TRACKS
    for i, label in enumerate(MILESTONE_LABELS)
]

# 旧版（单论文、6 节点）的标签 → 新版节点标签。启动时按它把老数据搬到「论文 1」轨道。
# 1:1 映射，新节点里的「学基础 / 看论文」在旧版没有对应，留空。
LEGACY_LABEL_MAP = {
    "开题": "出想法",
    "初稿": "写论文",
    "中期": "改论文",
    "查重": "修论文",
    "送审": "已投稿",
    "答辩": "中论文",
}

# 轨道号 → 配置里的键名。里程碑用 track=1/2 标记，配置里用 paper1/paper2 更可读。
RISK_TRACK_KEYS = {1: "paper1", 2: "paper2"}


def _baseline(**overrides):
    """一条轨道的基准月数表：默认全为「不设期限」，再按需覆盖。"""
    base = {label: None for label in MILESTONE_LABELS}
    base.update(overrides)
    return base


# 风险基准：以「入学年 anchor_month 月」为第 0 个月，各节点从锚点往后偏移若干个月。
# 值为 None 表示该节点不设期限、不参与风险判定。
# 按论文分轨 —— 第二篇论文的时间点整体晚于第一篇。
# 例：2026 级（2026-09 入学）→ paper1 出想法 = 2027-09，paper2 出想法 = 2028-05。
DEFAULT_RISK_CONFIG = {
    "anchor_month": 9,
    "baselines": {
        "paper1": _baseline(出想法=12, 写论文=14, 改论文=16, 已投稿=18),
        "paper2": _baseline(出想法=20, 写论文=22, 改论文=23, 已投稿=24),
    },
}

# 风险等级，按严重程度从轻到重排列（风险取所有参与判定节点里最严重的一级）
RISK_LEVELS = ["遥遥领先", "进度正常", "预警关注", "严重滞后"]

RISK_CONFIG_KEY = "risk_config"

# 学期基准周配置：老师端自定义「哪一周算第一周」。
# 存 {"start_weeks": {"2026-autumn": "2026-W37"}} —— 按学期分别记，
# 换学期不会把上一个学期设过的基准覆盖掉。
SEMESTER_CONFIG_KEY = "semester_config"


def upgrade_legacy_milestones(legacy: list) -> list | None:
    """旧版「6 节点·单论文」→ 新版「8 节点 × 2 轨道」。

    已经是新结构（每项带 track）返回 None，表示不需要升级。
    新旧标签名完全不同（开题 vs 出想法），必须经 LEGACY_LABEL_MAP 转译。

    启动时的数据迁移（database._migrate_milestones）和演示数据写入
    （demo_data.apply_student_demo）共用这一份实现。
    """
    if not isinstance(legacy, list) or not legacy:
        return None
    if any(isinstance(m, dict) and "track" in m for m in legacy):
        return None
    migrated = {}
    for old in legacy:
        if not isinstance(old, dict):
            continue
        new_label = LEGACY_LABEL_MAP.get(old.get("label"))
        if new_label:
            migrated[new_label] = old
    out = []
    for m in DEFAULT_MILESTONES:
        src = migrated.get(m["label"]) if m["track"] == 1 else None
        out.append({**m, "plan": (src or {}).get("plan"),
                    "actual": (src or {}).get("actual")})
    return out


class ThesisProject(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    student_id: int = Field(foreign_key="user.id", index=True)
    title: str = ""
    stage: str = "开题"
    progress: int = 0  # 0-100
    milestones_json: str = ""  # JSON: [{key,label,plan,actual}]
    # 老师手动指定的风险等级（正常/预警/滞后）。为空则回落到 compute_risk() 自动判定
    risk_override: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)


class Message(SQLModel, table=True):
    """老师发给指定学生的定向消息（一键催办 / 提醒）"""
    id: Optional[int] = Field(default=None, primary_key=True)
    from_id: int = Field(foreign_key="user.id", index=True)
    to_id: int = Field(foreign_key="user.id", index=True)
    topic: str = "论文管理"  # 论文管理 | 周报 | 问答点评
    content: str = ""
    created_at: datetime = Field(default_factory=datetime.utcnow)
    read_at: Optional[datetime] = None


class ThesisRound(SQLModel, table=True):
    """论文多轮往返：学生提交 -> 老师批注返回"""
    id: Optional[int] = Field(default=None, primary_key=True)
    project_id: int = Field(foreign_key="thesisproject.id", index=True)
    round_no: int = 1
    student_text: str = ""
    student_file: Optional[str] = None  # 存储文件名
    student_file_orig: Optional[str] = None  # 原始文件名
    submitted_at: datetime = Field(default_factory=datetime.utcnow)
    teacher_comment: Optional[str] = None
    teacher_file: Optional[str] = None
    teacher_file_orig: Optional[str] = None
    feedback_at: Optional[datetime] = None


class WeeklyReport(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    student_id: int = Field(foreign_key="user.id", index=True)
    week: str = Field(index=True)  # 例如 2026-W37
    content_md: str = ""
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class ReportAttachment(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    report_id: int = Field(foreign_key="weeklyreport.id", index=True)
    stored_name: str
    original_name: str
    image_mime: Optional[str] = None


class ReportComment(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    report_id: int = Field(foreign_key="weeklyreport.id", index=True)
    author_id: int = Field(foreign_key="user.id")
    content: str
    created_at: datetime = Field(default_factory=datetime.utcnow)


class Question(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    author_id: int = Field(foreign_key="user.id")
    content: str
    created_at: datetime = Field(default_factory=datetime.utcnow)


class Reply(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    question_id: int = Field(foreign_key="question.id", index=True)
    author_id: int = Field(foreign_key="user.id")
    content: str
    created_at: datetime = Field(default_factory=datetime.utcnow)


class Announcement(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    author_id: int = Field(foreign_key="user.id")
    title: str
    content: str
    created_at: datetime = Field(default_factory=datetime.utcnow)


class AnnouncementAttachment(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    announcement_id: int = Field(foreign_key="announcement.id", index=True)
    stored_name: str
    original_name: str
    image_mime: Optional[str] = None


class Setting(SQLModel, table=True):
    """通用键值配置（目前只用来存风险基准时间，见 DEFAULT_RISK_CONFIG）。

    单独建表而不是塞进某个既有的表：create_all 会自动建这张新表，
    不需要为它写迁移脚本。
    """
    key: str = Field(primary_key=True)
    value: str = ""  # JSON 字符串


class Link(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    title: str
    url: str
    created_by: int = Field(foreign_key="user.id")
    created_at: datetime = Field(default_factory=datetime.utcnow)
