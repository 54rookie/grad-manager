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

DEFAULT_MILESTONES = [
    {"key": "kaiti", "label": "开题", "plan": None, "actual": None},
    {"key": "chugao", "label": "初稿", "plan": None, "actual": None},
    {"key": "zhongqi", "label": "中期", "plan": None, "actual": None},
    {"key": "chachong", "label": "查重", "plan": None, "actual": None},
    {"key": "songshen", "label": "送审", "plan": None, "actual": None},
    {"key": "dabian", "label": "答辩", "plan": None, "actual": None},
]


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


class Link(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    title: str
    url: str
    created_by: int = Field(foreign_key="user.id")
    created_at: datetime = Field(default_factory=datetime.utcnow)
