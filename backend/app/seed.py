"""首次启动时写入完整演示数据集（与 scripts/seed_student_demo.py 共享 app.demo_data）。"""
from sqlmodel import Session, select

from .auth import hash_password
from .database import engine
from .demo_data import GRADES, STUDENTS, DEMO, INITIAL_PASSWORD, apply_student_demo
from .models import Announcement, Link, User, Grade, ThesisProject, DEFAULT_MILESTONES
import json
from datetime import date, datetime, timedelta


def seed():
    with Session(engine) as s:
        # 已存在数据则跳过（日常重启动不会重复灌种子）
        if s.exec(select(User)).first():
            return

        # 年级
        grades = []
        for n in GRADES:
            g = Grade(name=n)
            s.add(g)
            grades.append(g)
        s.commit()
        for g in grades:
            s.refresh(g)
        by_name = {g.name: g for g in grades}

        # 老师
        teacher = User(
            username="teacher", password_hash=hash_password(INITIAL_PASSWORD),
            name="王老师", role="teacher",
        )
        s.add(teacher)
        s.commit()
        s.refresh(teacher)

        # 10 位学生
        students = []
        for uname, name, no, gname in STUDENTS:
            u = User(
                username=uname, password_hash=hash_password(INITIAL_PASSWORD),
                name=name, role="student", student_no=no, grade_id=by_name[gname].id,
            )
            s.add(u)
            students.append(u)
        s.commit()
        for u in students:
            s.refresh(u)

        # 为每位学生建一个空白论文项目（演示两位学生后续由 apply_student_demo 覆盖）
        today = date.today()
        empty_titles = [
            "面向边缘计算的轻量级模型压缩方法研究",   # liuwenqiang → 被 DEMO 覆盖
            "知识图谱驱动的智能问答系统设计与实现",     # liuzilong → 被 DEMO 覆盖
            "面向低资源场景的机器翻译方法",
            "城市热力图数据可视化平台设计",
            "多模态内容审核系统的设计与实现",
            "深度伪造视频检测的关键技术研究",
            "基于强化学习的工业排程优化",
            "自适应推荐系统的可解释性研究",
            "大规模图神经网络的分布式训练",
            "面向边缘场景的联邦学习方法",
        ]
        for stu, title in zip(students, empty_titles):
            ms = json.loads(json.dumps(DEFAULT_MILESTONES))
            base = today - timedelta(days=120)
            for j, m in enumerate(ms):
                plan_d = base + timedelta(days=j * 30)
                m["plan"] = str(plan_d)
            s.add(ThesisProject(
                student_id=stu.id, title=title, stage="开题", progress=10,
                milestones_json=json.dumps(ms, ensure_ascii=False),
            ))
        s.commit()

        # 给刘文强、刘子龙灌入完整测试数据（论文往返 / 周报 / 问答）
        for stu, uname in zip(students, [s[0] for s in STUDENTS]):
            if uname in DEMO:
                apply_student_demo(s, teacher, stu, DEMO[uname])

        # 公告 / 链接（从原 seed 平移过来）
        s.add(Announcement(
            author_id=teacher.id, title="中期检查安排",
            content="各位同学：中期检查定于本月 20 日下午 2 点在实验楼 301 进行，"
                      "请提前准备好中期报告和演示材料。",
        ))
        s.add(Link(title="学校图书馆", url="https://www.example.edu/library", created_by=teacher.id))
        s.add(Link(title="知网", url="https://www.cnki.net", created_by=teacher.id))

        s.commit()
        print(f"种子数据已写入：teacher/123456 + 10 位学生（{', '.join(u[0] for u in STUDENTS)}/123456），并给刘文强 / 刘子龙灌完整测试数据")
