"""公告编辑与附件保留；仅使用独立临时数据库和上传目录。"""

import io
import os
import tempfile
import unittest
from pathlib import Path


class AnnouncementEditTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix="grad-announcement-test-")
        cls.original_env = {key: os.environ.get(key) for key in ("GM_DB_PATH", "GM_UPLOAD_DIR")}
        os.environ["GM_DB_PATH"] = str(Path(cls.temp.name) / "test.db")
        os.environ["GM_UPLOAD_DIR"] = str(Path(cls.temp.name) / "uploads")

        from fastapi import UploadFile
        from sqlmodel import SQLModel, Session, create_engine
        from app import uploads
        from app.auth import require_teacher
        from app.models import Announcement, AnnouncementAttachment, User
        from app.routers import misc

        cls.UploadFile = UploadFile
        cls.Session = Session
        cls.SQLModel = SQLModel
        cls.User = User
        cls.Announcement = Announcement
        cls.AnnouncementAttachment = AnnouncementAttachment
        cls.misc = misc
        cls.require_teacher = staticmethod(require_teacher)
        cls.engine = create_engine(f"sqlite:///{Path(cls.temp.name) / 'test.db'}",
                                   connect_args={"check_same_thread": False})
        cls.old_upload_dir = uploads.UPLOAD_DIR
        uploads.UPLOAD_DIR = Path(cls.temp.name) / "uploads"
        uploads.UPLOAD_DIR.mkdir(exist_ok=True)

    @classmethod
    def tearDownClass(cls):
        from app import uploads
        uploads.UPLOAD_DIR = cls.old_upload_dir
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

    def upload(self, name, body):
        return self.UploadFile(filename=name, file=io.BytesIO(body))

    def test_edit_preserves_author_and_date_and_manages_files(self):
        from fastapi import HTTPException

        with self.Session(self.engine) as session:
            teacher = self.User(username="teacher-test", password_hash="x", name="老师", role="teacher")
            student = self.User(username="student-test", password_hash="x", name="学生", role="student")
            session.add_all([teacher, student])
            session.commit()

            created = self.misc.create_announcement_with_attachments(
                title="原标题", content="原内容",
                files=[self.upload("keep.txt", b"keep"), self.upload("remove.txt", b"remove")],
                session=session, teacher=teacher)
            keep_id, remove_id = [item["id"] for item in created["attachments"]]
            old_path = session.get(self.AnnouncementAttachment, remove_id).stored_name
            created_at = created["created_at"]

            updated = self.misc.update_announcement_with_attachments(
                aid=created["id"], title=" 新标题 ", content=" 新内容 ",
                keep_attachment_ids=[keep_id], files=[self.upload("new.txt", b"new")],
                session=session, teacher=teacher)
            self.assertEqual((updated["title"], updated["content"]), ("新标题", "新内容"))
            self.assertEqual((updated["created_at"], updated["author_name"]), (created_at, "老师"))
            self.assertEqual([item["name"] for item in updated["attachments"]], ["keep.txt", "new.txt"])
            self.assertIsNone(session.get(self.AnnouncementAttachment, remove_id))
            self.assertFalse((Path(self.temp.name) / "uploads" / old_path).exists())
            self.assertEqual(self.misc.announcement_attachment(
                attachment_id=keep_id, session=session, user=student).path.read_bytes(), b"keep")

            with self.assertRaises(HTTPException) as denied:
                self.require_teacher(student)
            self.assertEqual(denied.exception.status_code, 403)
            with self.assertRaises(HTTPException) as invalid:
                self.misc.update_announcement_with_attachments(
                    aid=created["id"], title="无效", content="无效",
                    keep_attachment_ids=[999999], files=[], session=session, teacher=teacher)
            self.assertEqual(invalid.exception.status_code, 400)
            self.assertEqual(session.get(self.Announcement, created["id"]).title, "新标题")


if __name__ == "__main__":
    unittest.main()
