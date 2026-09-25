"""Private attachment storage shared by reports and announcements."""
import uuid
import logging
from pathlib import Path

from fastapi import HTTPException, UploadFile

from .database import UPLOAD_DIR

MAX_FILE_BYTES = 20 * 1024 * 1024
MAX_FILES = 10
logger = logging.getLogger(__name__)


def save_upload(file: UploadFile) -> tuple[str, str, str | None]:
    original = Path(file.filename or "file").name[:255] or "file"
    body = file.file.read(MAX_FILE_BYTES + 1)
    if len(body) > MAX_FILE_BYTES:
        raise HTTPException(400, f"附件「{original}」不能超过 20 MB")
    if not body:
        raise HTTPException(400, f"附件「{original}」不能为空")
    # Only raster formats are rendered inline. Everything else downloads.
    mime = None
    if body.startswith(b"\x89PNG\r\n\x1a\n"):
        mime = "image/png"
    elif body.startswith(b"\xff\xd8\xff"):
        mime = "image/jpeg"
    elif body[:6] in (b"GIF87a", b"GIF89a"):
        mime = "image/gif"
    elif body.startswith(b"RIFF") and body[8:12] == b"WEBP":
        mime = "image/webp"
    elif body.startswith(b"BM"):
        mime = "image/bmp"
    elif body[4:8] == b"ftyp" and body[8:12] in (b"avif", b"avis"):
        mime = "image/avif"
    stored = uuid.uuid4().hex
    path = UPLOAD_DIR / stored
    try:
        path.write_bytes(body)
    except Exception:
        delete_upload(stored)
        raise
    return stored, original, mime


def delete_upload(stored: str) -> None:
    try:
        (UPLOAD_DIR / stored).unlink(missing_ok=True)
    except OSError:
        # 数据库提交后无法回滚；清理失败不能把已成功的请求报告成失败。
        logger.exception("附件清理失败: %s", stored)


def upload_path(stored: str) -> Path:
    path = UPLOAD_DIR / stored
    if not path.is_file():
        raise HTTPException(404, "文件不存在")
    return path
