import os
import secrets
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import bcrypt
from jose import jwt, JWTError
from sqlmodel import Session, select

from .database import DB_PATH, get_session
from .models import User


def _load_secret_key() -> str:
    """JWT 签名密钥：优先环境变量，其次一份自动生成并持久化的随机密钥。

    取值顺序：
      1. 环境变量 GM_SECRET_KEY（部署时最推荐，便于多实例共享）
      2. 文件 GM_SECRET_KEY_FILE（默认与数据库同目录的 grad_manager.key）
         —— 不存在就生成一份 512 位随机密钥写进去，下次启动复用
      3. 上面都写不了（只读文件系统）→ 退化成进程内随机密钥

    ⚠️ 绝不要把密钥硬编码进代码。仓库是公开的，任何人拿到这串常量
    就能自己签发一个 role=teacher 的 token 冒充导师登录，连密码都不用。
    """
    env = os.environ.get("GM_SECRET_KEY")
    if env:
        return env

    path = Path(os.environ.get("GM_SECRET_KEY_FILE", DB_PATH.parent / "grad_manager.key"))
    try:
        if path.exists():
            existing = path.read_text(encoding="utf-8").strip()
            if existing:
                return existing
        key = secrets.token_urlsafe(48)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(key, encoding="utf-8")
        try:
            path.chmod(0o600)   # 只有属主可读；失败不影响功能
        except OSError:
            pass
        return key
    except OSError:
        # 只读文件系统等极端情况：至少不要退回到一个公开已知的常量
        return secrets.token_urlsafe(48)


SECRET_KEY = _load_secret_key()
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_HOURS = 72

bearer = HTTPBearer()


def hash_password(p: str) -> str:
    return bcrypt.hashpw(p.encode()[:72], bcrypt.gensalt()).decode()


def verify_password(p: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(p.encode()[:72], hashed.encode())
    except ValueError:
        return False


def create_token(user_id: int) -> str:
    payload = {
        "sub": str(user_id),
        "exp": datetime.utcnow() + timedelta(hours=ACCESS_TOKEN_EXPIRE_HOURS),
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def get_current_user(
    cred: HTTPAuthorizationCredentials = Depends(bearer),
    session: Session = Depends(get_session),
) -> User:
    try:
        payload = jwt.decode(cred.credentials, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = int(payload.get("sub"))
    except (JWTError, TypeError, ValueError):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "无效的登录凭证")
    user = session.get(User, user_id)
    if not user:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "用户不存在")
    return user


def require_teacher(user: User = Depends(get_current_user)) -> User:
    if user.role != "teacher":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "仅老师可执行此操作")
    return user
