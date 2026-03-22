from __future__ import annotations

import os
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

import uvicorn
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError
from fastapi import Cookie, Depends, FastAPI, HTTPException, Request, Response, status
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from pydantic import BaseModel, Field

from app_data import FocusDataStore


ROOT = Path(__file__).resolve().parent
HOST = os.environ.get("FOCUS_HOST", "127.0.0.1")
PORT = int(os.environ.get("FOCUS_PORT", "8000"))
SESSION_COOKIE_NAME = os.environ.get("SESSION_COOKIE_NAME", "focus_session")
SESSION_MAX_AGE_SECONDS = int(os.environ.get("SESSION_MAX_AGE_SECONDS", "604800"))
PASSWORD_HASHER = PasswordHasher()


class LoginRequest(BaseModel):
    username: str
    password: str


class ContentPayload(BaseModel):
    notes: str = ""
    tasks: list[dict[str, Any]] = Field(default_factory=list)
    layout: dict[str, Any] = Field(default_factory=dict)
    links: list[dict[str, Any]] = Field(default_factory=list)


def build_app(data_store: FocusDataStore | None = None, secret_key: str | None = None) -> FastAPI:
    store = data_store or FocusDataStore(project_root=ROOT)
    serializer = URLSafeTimedSerializer(
        secret_key or os.environ.get("APP_SECRET_KEY", "local-dev-secret-change-me"),
        salt="focus-session",
    )

    app = FastAPI(title="Focus App", version="1.0.0")
    app.mount("/background", StaticFiles(directory=str(ROOT / "background")), name="background")
    app.mount("/static", StaticFiles(directory=str(ROOT / "static")), name="static")

    def normalize_origin(value: str) -> str:
        return value.rstrip("/").lower()

    def configured_allowed_origins() -> set[str]:
        raw = os.environ.get("ALLOWED_ORIGINS", "")
        return {
            normalize_origin(item.strip())
            for item in raw.split(",")
            if item.strip()
        }

    def validate_origin(request: Request) -> None:
        origin = request.headers.get("origin")
        if not origin:
            return

        expected_origins = configured_allowed_origins()
        expected_origins.add(normalize_origin(f"{request.url.scheme}://{request.url.netloc}"))

        forwarded_proto = request.headers.get("x-forwarded-proto")
        forwarded_host = request.headers.get("x-forwarded-host") or request.headers.get("host")
        if forwarded_proto and forwarded_host:
            expected_origins.add(normalize_origin(f"{forwarded_proto}://{forwarded_host}"))

        parsed_origin = urlsplit(origin)
        current_host = request.headers.get("x-forwarded-host") or request.headers.get("host") or request.url.netloc
        if parsed_origin.hostname and current_host:
            current_host_name = current_host.split(":", 1)[0].lower()
            if parsed_origin.hostname.lower() == current_host_name:
                expected_origins.add(normalize_origin(origin))

        if normalize_origin(origin) not in expected_origins:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid origin")

    def is_secure_cookie(request: Request) -> bool:
        configured = os.environ.get("SESSION_COOKIE_SECURE")
        if configured is not None:
            return configured.strip().lower() in {"1", "true", "yes", "on"}
        return request.url.scheme == "https"

    def create_session_token(username: str) -> str:
        return serializer.dumps({"sub": store.normalize_username(username)})

    def parse_session_token(token: str) -> str:
        try:
            payload = serializer.loads(token, max_age=SESSION_MAX_AGE_SECONDS)
        except SignatureExpired as exc:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expired") from exc
        except BadSignature as exc:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid session") from exc

        username = payload.get("sub")
        if not isinstance(username, str):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid session")

        user = store.get_user_record(username)
        if user is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unknown user")

        return username

    def set_session_cookie(response: Response, request: Request, username: str) -> None:
        response.set_cookie(
            key=SESSION_COOKIE_NAME,
            value=create_session_token(username),
            max_age=SESSION_MAX_AGE_SECONDS,
            httponly=True,
            samesite="lax",
            secure=is_secure_cookie(request),
            path="/",
        )

    def clear_session_cookie(response: Response) -> None:
        response.delete_cookie(key=SESSION_COOKIE_NAME, path="/", httponly=True, samesite="lax")

    def require_user(session_token: str | None = Cookie(default=None, alias=SESSION_COOKIE_NAME)) -> str:
        if not session_token:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")
        return parse_session_token(session_token)

    @app.get("/", include_in_schema=False)
    def serve_index() -> FileResponse:
        return FileResponse(ROOT / "index.html")

    @app.get("/index.html", include_in_schema=False)
    def serve_index_html() -> FileResponse:
        return FileResponse(ROOT / "index.html")

    @app.get("/healthz")
    def healthz() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/api/me")
    def get_me(username: str = Depends(require_user)) -> dict[str, Any]:
        user = store.get_user_record(username)
        if user is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")

        return {
            "username": username,
            "is_admin": bool(user.get("is_admin")),
        }

    @app.post("/api/login")
    def login(payload: LoginRequest, request: Request) -> Response:
        validate_origin(request)
        username = store.normalize_username(payload.username)
        user = store.get_user_record(username)
        if user is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid username or password")

        password_hash = str(user.get("password_hash", ""))
        try:
            PASSWORD_HASHER.verify(password_hash, payload.password)
        except (VerifyMismatchError, InvalidHashError) as exc:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid username or password") from exc

        if PASSWORD_HASHER.check_needs_rehash(password_hash):
            users_data = store.load_users()
            users_data["users"][username]["password_hash"] = PASSWORD_HASHER.hash(payload.password)
            store.save_users(users_data)

        response = JSONResponse(
            {
                "username": username,
                "is_admin": bool(user.get("is_admin")),
            }
        )
        set_session_cookie(response, request, username)
        return response

    @app.post("/api/logout")
    def logout(request: Request) -> Response:
        validate_origin(request)
        response = JSONResponse({"ok": True})
        clear_session_cookie(response)
        return response

    @app.get("/api/content")
    def get_content(username: str = Depends(require_user)) -> dict[str, Any]:
        return store.load_user_content(username)

    @app.post("/api/content")
    def save_content(payload: ContentPayload, request: Request, username: str = Depends(require_user)) -> dict[str, Any]:
        validate_origin(request)
        return store.save_user_content(username, payload.model_dump())

    return app


app = build_app()


def main() -> None:
    uvicorn.run("server:app", host=HOST, port=PORT, proxy_headers=True)


if __name__ == "__main__":
    main()
