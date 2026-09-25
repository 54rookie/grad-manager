"""周报免交规则；只使用独立临时 SQLite 库和上传目录。"""

import json
import os
import tempfile
import unittest
from datetime import date, timedelta


class ReportAscensionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix="grad-report-test-")
        cls.original_env = {key: os.environ.get(key) for key in ("GM_DB_PATH", "GM_UPLOAD_DIR")}
        os.environ["GM_DB_PATH"] = os.path.join(cls.temp.name, "test.db")
        os.environ["GM_UPLOAD_DIR"] = os.path.join(cls.temp.name, "uploads")
        from sqlmodel import SQLModel
        from app.database import engine
        from app.models import DEFAULT_MILESTONES, ReportAscension, ThesisProject, User, WeeklyReport
        from app.routers import grades, reports, thesis
        from app.report_status import ascended_from_week
        cls.SQLModel = SQLModel
        cls.engine = engine
        cls.DEFAULT_MILESTONES = DEFAULT_MILESTONES
        cls.ThesisProject = ThesisProject
        cls.ReportAscension = ReportAscension
        cls.User = User
        cls.WeeklyReport = WeeklyReport
        cls.reports = reports
        cls.thesis = thesis
        cls.grades = grades
        cls.ascended_from_week = staticmethod(ascended_from_week)

    @classmethod
    def tearDownClass(cls):
        cls.engine.dispose()
        cls.temp.cleanup()
        for key, value in cls.original_env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value

    def setUp(self):
        self.SQLModel.metadata.drop_all(self.engine)
        self.SQLModel.metadata.create_all(self.engine)

    def test_ascended_status_and_reversal(self):
        from sqlmodel import Session

        with Session(self.engine) as session:
            teacher = self.User(username="teacher", password_hash="x", name="老师", role="teacher")
            ascended = self.User(username="ascended", password_hash="x", name="已完成", role="student")
            ordinary = self.User(username="ordinary", password_hash="x", name="普通", role="student")
            session.add_all([teacher, ascended, ordinary])
            session.commit()
            nodes = json.loads(json.dumps(self.DEFAULT_MILESTONES, ensure_ascii=False))
            for node in nodes:
                if node["label"] not in ("修论文", "中论文"):
                    node["actual"] = date.today().isoformat()
            project = self.ThesisProject(student_id=ascended.id, milestones_json=json.dumps(nodes, ensure_ascii=False))
            session.add(project)
            session.commit()

            current = self.reports.current_week()
            past = self.reports.week_key(date.today() - timedelta(days=14))
            future = self.reports.week_key(date.today() + timedelta(days=14))
            session.add(self.WeeklyReport(student_id=ordinary.id, week=current, content_md="已提交"))
            session.add(self.WeeklyReport(student_id=ascended.id, week=future, content_md="自愿提交"))
            session.commit()

            def status_for(week):
                return {item["student_id"]: item["status"] for item in
                        self.reports.board(week=week, session=session, teacher=teacher)["items"]}

            self.assertEqual(status_for(past)[ascended.id], "逾期")
            self.assertEqual(status_for(current)[ascended.id], "已飞升")
            self.assertEqual(status_for(current)[ordinary.id], "已交")
            self.assertEqual(status_for(future)[ascended.id], "已飞升")
            current_items = self.reports.board(week=current, session=session, teacher=teacher)["items"]
            required = [item for item in current_items if item["status"] != "已飞升"]
            self.assertEqual((len(required), sum(item["status"] == "已交" for item in required)), (1, 1))
            future_items = self.reports.board(week=future, session=session, teacher=teacher)["items"]
            self.assertIsNotNone(next(item["report"] for item in future_items
                                      if item["student_id"] == ascended.id))
            self.assertEqual(self.reports.list_weeks(session=session, user=ascended)["ascended_from_week"], current)
            self.assertEqual(self.thesis.project_view(project, session)["ascended_from_week"], current)

            nodes[0]["actual"] = None
            self.thesis.update_project(project.id, self.thesis.ProjectIn(milestones=nodes),
                                       session=session, user=teacher)
            self.assertEqual(status_for(current)[ascended.id], "未交")
            self.assertEqual(status_for(future)[ascended.id], "已交")
            self.assertIsNone(self.reports.list_weeks(session=session, user=ascended)["ascended_from_week"])
            self.assertIsNone(self.thesis.project_view(project, session)["ascended_from_week"])

    def test_past_ascended_weeks_survive_reversal(self):
        from sqlmodel import Session

        with Session(self.engine) as session:
            teacher = self.User(username="teacher", password_hash="x", name="老师", role="teacher")
            student = self.User(username="student", password_hash="x", name="学生", role="student")
            session.add_all([teacher, student])
            session.commit()
            completed = date.today() - timedelta(days=21)
            nodes = json.loads(json.dumps(self.DEFAULT_MILESTONES, ensure_ascii=False))
            for node in nodes:
                if node["label"] not in ("修论文", "中论文"):
                    node["actual"] = completed.isoformat()
            project = self.ThesisProject(student_id=student.id, milestones_json=json.dumps(nodes, ensure_ascii=False))
            session.add(project)
            session.commit()
            history_week = self.reports.week_key(date.today() - timedelta(days=14))
            current = self.reports.current_week()

            def status(week):
                return self.reports.board(week=week, session=session, teacher=teacher)["items"][0]["status"]

            self.assertEqual(status(history_week), "已飞升")
            nodes[0]["actual"] = None
            self.thesis.update_project(project.id, self.thesis.ProjectIn(milestones=nodes),
                                       session=session, user=teacher)
            self.assertEqual(status(history_week), "已飞升")
            self.assertEqual(status(current), "未交")
            archived = self.reports.list_weeks(session=session, user=student)["ascension_windows"]
            self.assertEqual(archived[0]["end_week"], self.reports.week_key(
                date.today() - timedelta(days=date.today().weekday() + 1)))
            history_semester = self.reports.semester_of(self.reports.monday_of(history_week))
            stats = self.reports.semester_stats(semester=history_semester, session=session, teacher=teacher)
            history_stats = next(item for item in stats["weeks"] if item["week"] == history_week)
            self.assertEqual((history_stats["required"], history_stats["ascended"]), (0, 1))

            nodes[0]["actual"] = date.today().isoformat()
            self.thesis.update_project(project.id, self.thesis.ProjectIn(milestones=nodes),
                                       session=session, user=teacher)
            self.assertEqual(status(current), "已飞升")
            self.assertEqual(len(self.reports.list_weeks(session=session, user=student)["ascension_windows"]), 2)

    def test_current_submitted_report_becomes_ascended_on_completion(self):
        from sqlmodel import Session

        with Session(self.engine) as session:
            teacher = self.User(username="teacher", password_hash="x", name="老师", role="teacher")
            student = self.User(username="student", password_hash="x", name="刘文强", role="student")
            session.add_all([teacher, student])
            session.commit()
            week = self.reports.current_week()
            session.add(self.WeeklyReport(student_id=student.id, week=week, content_md="本周已有周报"))
            nodes = json.loads(json.dumps(self.DEFAULT_MILESTONES, ensure_ascii=False))
            for node in nodes:
                if node["label"] not in ("修论文", "中论文"):
                    node["actual"] = date.today().isoformat()
            nodes[0]["actual"] = None
            project = self.ThesisProject(student_id=student.id, milestones_json=json.dumps(nodes, ensure_ascii=False))
            session.add(project)
            session.commit()
            before = self.reports.board(week=week, session=session, teacher=teacher)["items"][0]
            self.assertEqual(before["status"], "已交")

            nodes[0]["actual"] = date.today().isoformat()
            self.thesis.update_project(project.id, self.thesis.ProjectIn(milestones=nodes),
                                       session=session, user=teacher)
            after = self.reports.board(week=week, session=session, teacher=teacher)["items"][0]
            self.assertEqual(after["status"], "已飞升")
            self.assertEqual(after["report"]["content_md"], "本周已有周报")
            counts = self.reports.semester_stats(session=session, teacher=teacher)["current_week"]
            self.assertEqual((counts["required"], counts["submitted"], counts["ascended"], counts["rate"]),
                             (0, 0, 1, 100))

    def test_current_class_rate_excludes_ascended_students(self):
        from sqlmodel import Session

        with Session(self.engine) as session:
            teacher = self.User(username="teacher", password_hash="x", name="老师", role="teacher")
            session.add(teacher)
            session.commit()
            week = self.reports.current_week()
            for index in range(10):
                student = self.User(username=f"s{index}", password_hash="x", name=f"学生{index}", role="student")
                session.add(student)
                session.flush()
                if index < 2:
                    nodes = json.loads(json.dumps(self.DEFAULT_MILESTONES, ensure_ascii=False))
                    for node in nodes:
                        if node["label"] not in ("修论文", "中论文"):
                            node["actual"] = date.today().isoformat()
                    session.add(self.ThesisProject(student_id=student.id,
                                                   milestones_json=json.dumps(nodes, ensure_ascii=False)))
                    if index == 0:
                        session.add(self.WeeklyReport(student_id=student.id, week=week,
                                                      content_md="飞升前已经提交"))
                else:
                    session.add(self.WeeklyReport(student_id=student.id, week=week, content_md="已交"))
            session.commit()
            statuses = {item["student_id"]: item for item in
                        self.reports.board(week=week, session=session, teacher=teacher)["items"]}
            self.assertEqual(sum(item["status"] == "已飞升" for item in statuses.values()), 2)
            self.assertTrue(any(item["status"] == "已飞升" and item["report"] for item in statuses.values()))
            stats = self.reports.semester_stats(session=session, teacher=teacher)
            current = stats["current_week"]
            self.assertEqual((current["required"], current["submitted"], current["ascended"], current["rate"]),
                             (8, 8, 2, 100))
            self.assertEqual(current["overdue"] + current["missing"], 0)

    def test_zero_denominator_is_explicit(self):
        from sqlmodel import Session

        with Session(self.engine) as session:
            teacher = self.User(username="teacher", password_hash="x", name="老师", role="teacher")
            session.add(teacher)
            session.commit()
            empty = self.reports.semester_stats(session=session, teacher=teacher)
            self.assertEqual((empty["student_count"], empty["current_week"]["rate"]), (0, 0))
            student = self.User(username="student", password_hash="x", name="学生", role="student")
            session.add(student)
            session.flush()
            nodes = json.loads(json.dumps(self.DEFAULT_MILESTONES, ensure_ascii=False))
            for node in nodes:
                if node["label"] not in ("修论文", "中论文"):
                    node["actual"] = date.today().isoformat()
            session.add(self.ThesisProject(student_id=student.id,
                                           milestones_json=json.dumps(nodes, ensure_ascii=False)))
            session.commit()
            all_exempt = self.reports.semester_stats(session=session, teacher=teacher)["current_week"]
            self.assertEqual((all_exempt["required"], all_exempt["ascended"], all_exempt["rate"]), (0, 1, 100))

    def test_advanced_nodes_do_not_block_ascension(self):
        nodes = json.loads(json.dumps(self.DEFAULT_MILESTONES, ensure_ascii=False))
        for node in nodes:
            if node["label"] not in ("修论文", "中论文"):
                node["actual"] = "2026-09-01"
        project = self.ThesisProject(student_id=1, milestones_json=json.dumps(nodes, ensure_ascii=False))
        self.assertEqual(self.ascended_from_week(project), "2026-W36")
        nodes[0]["actual"] = None
        nodes[0]["done"] = True
        project.milestones_json = json.dumps(nodes, ensure_ascii=False)
        self.assertIsNone(self.ascended_from_week(project))

    def test_current_completion_overrides_stale_future_window(self):
        from sqlmodel import Session

        with Session(self.engine) as session:
            teacher = self.User(username="teacher", password_hash="x", name="老师", role="teacher")
            student = self.User(username="student", password_hash="x", name="学生", role="student")
            session.add_all([teacher, student])
            session.flush()
            nodes = json.loads(json.dumps(self.DEFAULT_MILESTONES, ensure_ascii=False))
            for node in nodes:
                if node["label"] not in ("修论文", "中论文"):
                    node["actual"] = date.today().isoformat()
            session.add(self.ThesisProject(student_id=student.id,
                                           milestones_json=json.dumps(nodes, ensure_ascii=False)))
            session.add(self.ReportAscension(student_id=student.id,
                                             start_week=self.reports.week_key(date.today() + timedelta(days=14))))
            session.commit()
            current = self.reports.board(session=session, teacher=teacher)["items"][0]
            self.assertEqual(current["status"], "已飞升")

    def test_deleting_student_removes_ascension_history(self):
        from sqlmodel import Session, select

        with Session(self.engine) as session:
            teacher = self.User(username="teacher", password_hash="x", name="老师", role="teacher")
            student = self.User(username="student", password_hash="x", name="学生", role="student")
            session.add_all([teacher, student])
            session.commit()
            session.add(self.ReportAscension(student_id=student.id, start_week="2026-W36"))
            session.commit()
            self.grades.delete_user(student.id, session=session, _=teacher)
            self.assertEqual(session.exec(select(self.ReportAscension)).all(), [])


if __name__ == "__main__":
    unittest.main()
