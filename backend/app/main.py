from pathlib import Path

from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sqlmodel import Session, select

from .auth import verify_password, create_token, get_current_user, hash_password
from .database import init_db, get_session
from .models import User, Grade
from .routers import grades, thesis, reports, misc, messages

FRONTEND_DIST = Path(__file__).resolve().parent.parent.parent / "frontend" / "dist"

app = FastAPI(title="研究生管理系统")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173",
                   "http://localhost:5183", "http://127.0.0.1:5183"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class LoginIn(BaseModel):
    username: str
    password: str


@app.post("/api/login")
def login(data: LoginIn, session: Session = Depends(get_session)):
    user = session.exec(select(User).where(User.username == data.username)).first()
    if not user or not verify_password(data.password, user.password_hash):
        raise HTTPException(401, "用户名或密码错误")
    grade = session.get(Grade, user.grade_id) if user.grade_id else None
    return {
        "token": create_token(user.id),
        "user": {
            "id": user.id, "username": user.username, "name": user.name,
            "role": user.role, "student_no": user.student_no,
            "grade_name": grade.name if grade else None,
        },
    }


@app.get("/api/me")
def me(user: User = Depends(get_current_user), session: Session = Depends(get_session)):
    grade = session.get(Grade, user.grade_id) if user.grade_id else None
    return {
        "id": user.id, "username": user.username, "name": user.name,
        "role": user.role, "student_no": user.student_no,
        "grade_name": grade.name if grade else None,
    }


class PasswordIn(BaseModel):
    old_password: str
    new_password: str


@app.post("/api/me/password")
def change_password(
    data: PasswordIn,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    """老师与学生都可修改自己的登录密码"""
    if not verify_password(data.old_password, user.password_hash):
        raise HTTPException(400, "原密码不正确")
    if len(data.new_password) < 6:
        raise HTTPException(400, "新密码至少 6 位")
    if data.new_password == data.old_password:
        raise HTTPException(400, "新密码不能与原密码相同")
    user.password_hash = hash_password(data.new_password)
    session.add(user)
    session.commit()
    return {"ok": True}


app.include_router(grades.router)
app.include_router(thesis.router)
app.include_router(reports.router)
app.include_router(misc.router)
app.include_router(messages.router)

# ---------- 托管前端构建产物（单端口访问：http://localhost:5183） ----------
# 开发时用 Vite(5173) 热更新；执行 npm run build 后，5183 也能直接打开完整站点。
if FRONTEND_DIST.exists():
    assets = FRONTEND_DIST / "assets"
    if assets.exists():
        app.mount("/assets", StaticFiles(directory=assets), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa(full_path: str):
        if full_path.startswith("api/"):
            raise HTTPException(404, "Not Found")
        candidate = FRONTEND_DIST / full_path
        if full_path and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(FRONTEND_DIST / "index.html")


@app.on_event("startup")
def startup():
    init_db()
    from .seed import seed
    seed()
