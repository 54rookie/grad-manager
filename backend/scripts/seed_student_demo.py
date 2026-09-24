"""给指定学生灌入测试数据（论文项目 / 多轮往返 / 周报 / 问答），用于功能自测。

用法：cd backend && ./.venv/bin/python scripts/seed_student_demo.py
可重复执行：每次先清掉这两位学生的既有数据，再重新写入。
"""
import json
import sys
import uuid
from datetime import date, datetime, timedelta
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

from sqlmodel import Session, select  # noqa: E402

from app.auth import hash_password  # noqa: E402
from app.database import UPLOAD_DIR, engine  # noqa: E402
from app.models import (  # noqa: E402
    Question, Reply, ReportComment, ReportAttachment, ThesisProject, ThesisRound, User, WeeklyReport,
)

TEACHER = "teacher"

# ---------- 小工具 ----------

def write_upload(name: str, body: str) -> tuple[str, str]:
    """写入一个演示附件，返回 (存储名, 原始名)"""
    stored = f"{uuid.uuid4().hex}.pdf"
    (UPLOAD_DIR / stored).write_text(body, encoding="utf-8")
    return stored, name


def weeks_back(n: int) -> str:
    d = date.today() - timedelta(weeks=n)
    y, w, _ = d.isocalendar()
    return f"{y}-W{w:02d}"


def dt(days: int, hh: int = 10, mm: int = 0) -> datetime:
    day = date.today() + timedelta(days=days)
    return datetime(day.year, day.month, day.day, hh, mm)


def ms(key, label, plan, actual=None):
    return {"key": key, "label": label, "plan": plan, "actual": actual}


def d(offset_days: int) -> str:
    return str(date.today() + timedelta(days=offset_days))


# ---------- 两位学生的测试数据 ----------

DEMO = {
    "liuwenqiang": {
        "title": "面向边缘计算的轻量级模型压缩方法研究",
        "stage": "初稿",
        "progress": 55,
        "milestones": [
            ms("kaiti", "开题", d(-125), d(-127)),
            ms("chugao", "初稿", d(-59), d(-56)),
            ms("zhongqi", "中期", d(13)),          # 计划在未来 → 不算逾期
            ms("chachong", "查重", d(59)),
            ms("songshen", "送审", d(80)),
            ms("dabian", "答辩", d(99)),
        ],
        "rounds": [
            {
                "text": "老师好，这是我修改后的开题报告，已按意见聚焦到「端侧模型剪枝」这一条线，"
                        "技术路线重写了第三章，麻烦您再看一下。",
                "file": ("开题报告_V2.pdf", "%PDF-1.4\n演示附件：刘文强 开题报告 V2\n"),
                "comment": "聚焦后的方向可行，可以往下做。补充一点：第三章的实验环境要把数据集规模、"
                           "硬件型号写清楚，方便复现。",
                "cfile": ("开题报告_V2_批注版.pdf", "%PDF-1.4\n演示附件：开题报告 V2 批注版（红笔批注）\n"),
                "sub_days": -56, "rep_days": -53,
            },
            {
                "text": "已补上实验环境的硬件与数据说明，并把剪枝比例做成参数化配置。"
                        "初稿前面三章写完了，先发您过一遍。",
                "file": ("论文初稿_前三章.pdf", "%PDF-1.4\n演示附件：刘文强 论文初稿（前三章）\n"),
                "comment": None,
                "cfile": None,
                "sub_days": -3, "rep_days": None,
            },
        ],
        "reports": [
            (0, "## 本周进展\n- 完成 **前三章初稿**，共 41 页\n- 把剪枝比例做成参数化配置，跑了 3 组对照\n"
                "## 遇到问题\n- 边缘设备上的量化精度掉得比预期多，正在排查\n## 下周计划\n- 补齐消融实验，重写第四章",
             "收到。精度下降那组把中间层激活值分布画出来看看，下周三组会讲讲。"),
            (1, "## 本周进展\n- 整理实验环境说明与数据集统计表\n- 重写第三章技术路线\n## 下周计划\n- 开始写初稿前两章",
             "进度正常，保持。"),
            (2, "## 本周进展\n- 按批注意见修改开题报告\n- 补充近两年顶会文献 9 篇\n## 下周计划\n- 完成开题报告终稿", None),
            (3, "## 本周进展\n- 完成开题报告初稿\n- 与小组成员讨论技术路线\n## 下周计划\n- 等老师批注后修改", None),
        ],
        "questions": [
            ("请问学校图书馆的查重入口在哪里？第一次提交查重需要注意什么？",
             "图书馆主页右下角「学位论文查重」入口，用学号登录。第一次提交记得把致谢和附录一起删掉再传。"),
        ],
    },
    "liuzilong": {
        "title": "知识图谱驱动的智能问答系统设计与实现",
        "stage": "修改",
        "progress": 35,
        "milestones": [
            ms("kaiti", "开题", d(-145), d(-140)),
            ms("chugao", "初稿", d(-84), None),        # 计划已过且未完成 → 滞后
            ms("zhongqi", "中期", d(-42), None),       # 同样滞后
            ms("chachong", "查重", d(33)),
            ms("songshen", "送审", d(69)),
            ms("dabian", "答辩", d(98)),
        ],
        "rounds": [
            {
                "text": "老师，中期材料先发您：平台原型跑通了问答主流程，接口文档和数据字典见附件。",
                "file": ("中期检查材料.pdf", "%PDF-1.4\n演示附件：刘子龙 中期检查材料\n"),
                "comment": "进度说明和实物证据对不上：原型只有首页能点，图谱构建那部分没有截图。"
                           "请补开发日志和数据库 ER 图再交一次。",
                "cfile": ("中期材料_批注版.pdf", "%PDF-1.4\n演示附件：中期材料 批注版\n"),
                "sub_days": -42, "rep_days": -39,
            },
            {
                "text": "补充了开发日志（Git 提交记录导出）和 ER 图，问答模块的召回率测试也在附录里。",
                "file": ("中期材料_V2.pdf", "%PDF-1.4\n演示附件：刘子龙 中期材料 V2\n"),
                "comment": None,
                "cfile": None,
                "sub_days": -6, "rep_days": None,
            },
        ],
        "reports": [
            (0, "## 本周进展\n- 补开发日志与 ER 图\n- 跑通问答召回率测试，Top5 命中 71%\n"
                "## 遇到问题\n- 实体链接在长尾实体上错误率偏高\n## 下周计划\n- 优化实体链接，准备初稿",
             "开发日志这次补得完整。初稿 Deadline 在 10 月中旬，按现在的进度要压缩写作时间，"
             "建议本周把大纲先发我。"),
            (2, "## 本周进展\n- 搭建问答主流程原型**（仅首页可点，未完成）**\n## 说明\n- 中期材料准备仓促，部分截图未补", None),
        ],
        "questions": [
            ("中期检查可以用之前开题的材料吗？还是有规定的新模板？",
             None),
        ],
    },
}


def clean_student(s: Session, uid: int):
    """清掉某学生的项目 / 往返 / 周报 / 问答（含相关附件文件）"""
    from app.models import Grade  # noqa: F401 （保持导入完整性）

    for p in s.exec(select(ThesisProject).where(ThesisProject.student_id == uid)).all():
        for r in s.exec(select(ThesisRound).where(ThesisRound.project_id == p.id)).all():
            for f in (r.student_file, r.teacher_file):
                if f:
                    path = UPLOAD_DIR / f
                    if path.exists():
                        path.unlink()
            s.delete(r)
        s.delete(p)

    for rep in s.exec(select(WeeklyReport).where(WeeklyReport.student_id == uid)).all():
        for a in s.exec(select(ReportAttachment).where(ReportAttachment.report_id == rep.id)).all():
            (UPLOAD_DIR / a.stored_name).unlink(missing_ok=True)
            s.delete(a)
        for c in s.exec(select(ReportComment).where(ReportComment.report_id == rep.id)).all():
            s.delete(c)
        s.delete(rep)
    for c in s.exec(select(ReportComment).where(ReportComment.author_id == uid)).all():
        s.delete(c)

    for q in s.exec(select(Question).where(Question.author_id == uid)).all():
        for rep in s.exec(select(Reply).where(Reply.question_id == q.id)).all():
            s.delete(rep)
        s.delete(q)
    for rep in s.exec(select(Reply).where(Reply.author_id == uid)).all():
        s.delete(rep)
    s.commit()


def main():
    with Session(engine) as s:
        teacher = s.exec(select(User).where(User.username == TEACHER)).first()
        if not teacher:
            print("找不到老师账号，请先启动后端生成种子数据")
            return

        for username, cfg in DEMO.items():
            stu = s.exec(select(User).where(User.username == username)).first()
            if not stu:
                print(f"跳过：找不到学生 {username}")
                continue

            clean_student(s, stu.id)

            # 论文项目
            project = ThesisProject(
                student_id=stu.id, title=cfg["title"], stage=cfg["stage"],
                progress=cfg["progress"], milestones_json=json.dumps(cfg["milestones"], ensure_ascii=False),
            )
            s.add(project)
            s.commit()
            s.refresh(project)

            # 多轮往返
            for i, r in enumerate(cfg["rounds"], start=1):
                sf, so = write_upload(*r["file"]) if r["file"] else (None, None)
                row = ThesisRound(
                    project_id=project.id, round_no=i,
                    student_text=r["text"], student_file=sf, student_file_orig=so,
                    submitted_at=dt(r["sub_days"], 14, 20),
                )
                if r["comment"]:
                    row.teacher_comment = r["comment"]
                    row.teacher_file, row.teacher_file_orig = write_upload(*r["cfile"]) if r["cfile"] else (None, None)
                    row.feedback_at = dt(r["rep_days"], 9, 30)
                s.add(row)

            # 周报 + 老师点评
            for back, md, comment in cfg["reports"]:
                rep = WeeklyReport(
                    student_id=stu.id, week=weeks_back(back), content_md=md,
                    created_at=dt(-back * 7 + 1, 20, 15),
                )
                s.add(rep)
                s.commit()
                s.refresh(rep)
                if comment:
                    s.add(ReportComment(report_id=rep.id, author_id=teacher.id, content=comment,
                                        created_at=dt(-back * 7 + 2, 9, 20)))

            # 问答
            for content, reply in cfg["questions"]:
                q = Question(author_id=stu.id, content=content, created_at=dt(-2, 15, 40))
                s.add(q)
                s.commit()
                s.refresh(q)
                if reply:
                    s.add(Reply(question_id=q.id, author_id=teacher.id, content=reply, created_at=dt(-2, 18, 5)))

            s.commit()
            print(f"✓ {stu.name}（{username}）：项目 1 个 / 往返 {len(cfg['rounds'])} 轮 / "
                  f"周报 {len(cfg['reports'])} 份 / 提问 {len(cfg['questions'])} 条")

        print("\n完成。老师账号 teacher/123456 可在「论文管理」批注待批注轮次，在「周报」查看提交情况。")


if __name__ == "__main__":
    main()
