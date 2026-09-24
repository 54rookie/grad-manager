"""Private attachment storage shared by reports and announcements."""
import uuid
from pathlib import Path

from fastapi import HTTPException, UploadFile

from .database import UPLOAD_DIR

MAX_FILE_BYTES = 20 * 1024 * 1024
MAX_FILES = 10


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
    (UPLOAD_DIR / stored).write_bytes(body)
    return stored, original, mime


def delete_upload(stored: str) -> None:
    (UPLOAD_DIR / stored).unlink(missing_ok=True)


def upload_path(stored: str) -> Path:
    path = UPLOAD_DIR / stored
    if not path.is_file():
        raise HTTPException(404, "文件不存在")
    return path
