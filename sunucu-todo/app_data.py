from __future__ import annotations

import json
import os
import re
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


USERNAME_PATTERN = re.compile(r"^[a-z0-9_.-]{3,64}$")

DEFAULT_LAYOUT = {
    "notes": {"x": 0.02, "y": 0.05, "width": 0.31, "height": 0.47, "z": 1},
    "tasks": {"x": 0.35, "y": 0.05, "width": 0.28, "height": 0.47, "z": 2},
    "music": {"x": 0.65, "y": 0.05, "width": 0.33, "height": 0.47, "z": 3},
    "timer": {"x": 0.02, "y": 0.57, "width": 0.24, "height": 0.24, "z": 4},
    "sound": {"x": 0.28, "y": 0.57, "width": 0.22, "height": 0.18, "z": 5},
}

USERS_FILE_NAME = "users.json"
USER_DATA_DIR_NAME = "user_data"


def default_content() -> dict[str, Any]:
    return {
        "notes": "",
        "tasks": [],
        "layout": deepcopy(DEFAULT_LAYOUT),
        "links": [],
    }


class FocusDataStore:
    def __init__(self, project_root: Path | str | None = None, data_root: Path | str | None = None) -> None:
        root_from_env = os.environ.get("FOCUS_PROJECT_ROOT")
        data_from_env = os.environ.get("FOCUS_DATA_DIR")

        self.project_root = Path(project_root or root_from_env or Path(__file__).resolve().parent).resolve()
        self.data_root = Path(data_root or data_from_env or self.project_root / "data").resolve()
        self.users_file = self.data_root / USERS_FILE_NAME
        self.user_data_root = self.data_root / USER_DATA_DIR_NAME

    def ensure_structure(self) -> None:
        self.data_root.mkdir(parents=True, exist_ok=True)
        self.user_data_root.mkdir(parents=True, exist_ok=True)

        if not self.users_file.exists():
            self.users_file.write_text(
                json.dumps({"users": {}}, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )

    def normalize_username(self, username: str) -> str:
        return username.strip().lower()

    def validate_username(self, username: str) -> bool:
        return bool(USERNAME_PATTERN.fullmatch(self.normalize_username(username)))

    def load_users(self) -> dict[str, Any]:
        self.ensure_structure()
        raw = self.users_file.read_text(encoding="utf-8")
        if not raw.strip():
            return {"users": {}}

        data = json.loads(raw)
        if not isinstance(data, dict):
            raise ValueError("users.json must contain an object")

        users = data.get("users", {})
        if not isinstance(users, dict):
            raise ValueError("users.json must contain a users object")

        return {"users": users}

    def save_users(self, users_data: dict[str, Any]) -> None:
        self.data_root.mkdir(parents=True, exist_ok=True)
        self.user_data_root.mkdir(parents=True, exist_ok=True)
        self.users_file.write_text(
            json.dumps(users_data, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )

    def get_user_record(self, username: str) -> dict[str, Any] | None:
        normalized = self.normalize_username(username)
        users = self.load_users()["users"]
        user = users.get(normalized)
        return user if isinstance(user, dict) else None

    def create_user(
        self,
        username: str,
        password_hash: str,
        *,
        is_admin: bool = False,
        migrate_legacy: bool = False,
    ) -> dict[str, Any]:
        normalized = self.normalize_username(username)
        if not self.validate_username(normalized):
            raise ValueError("Username must be 3-64 chars and use only a-z, 0-9, ., _, -")

        users_data = self.load_users()
        users = users_data["users"]
        if normalized in users:
            raise ValueError(f"User '{normalized}' already exists")

        users[normalized] = {
            "username": normalized,
            "password_hash": password_hash,
            "is_admin": bool(is_admin),
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        self.save_users(users_data)

        content = self.load_legacy_content() if migrate_legacy else default_content()
        self.save_user_content(normalized, content)
        return users[normalized]

    def user_dir(self, username: str) -> Path:
        normalized = self.normalize_username(username)
        path = self.user_data_root / normalized
        path.mkdir(parents=True, exist_ok=True)
        return path

    def user_content_path(self, username: str) -> Path:
        return self.user_dir(username) / "content.json"

    def load_user_content(self, username: str) -> dict[str, Any]:
        path = self.user_content_path(username)
        if not path.exists():
            content = default_content()
            self.save_user_content(username, content)
            return content

        raw = path.read_text(encoding="utf-8")
        if not raw.strip():
            content = default_content()
            self.save_user_content(username, content)
            return content

        parsed = json.loads(raw)
        return self.normalize_content(parsed)

    def save_user_content(self, username: str, content: dict[str, Any]) -> dict[str, Any]:
        normalized = self.normalize_content(content)
        self.user_content_path(username).write_text(
            json.dumps(normalized, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        return normalized

    def normalize_content(self, content: dict[str, Any] | None) -> dict[str, Any]:
        normalized = default_content()
        if not isinstance(content, dict):
            return normalized

        notes = content.get("notes", "")
        normalized["notes"] = notes if isinstance(notes, str) else ""

        tasks: list[dict[str, Any]] = []
        raw_tasks = content.get("tasks", [])
        if isinstance(raw_tasks, list):
            for item in raw_tasks:
                if not isinstance(item, dict):
                    continue
                text = str(item.get("text", "")).strip()
                if not text:
                    continue
                tasks.append({"text": text, "done": bool(item.get("done"))})
        normalized["tasks"] = tasks

        links: list[dict[str, str]] = []
        raw_links = content.get("links", [])
        if isinstance(raw_links, list):
            for index, item in enumerate(raw_links, start=1):
                if not isinstance(item, dict):
                    continue
                url = str(item.get("url", "")).strip()
                if not url:
                    continue
                title = str(item.get("title", "")).strip() or f"Link {index}"
                links.append({"title": title, "url": url})
        normalized["links"] = links

        raw_layout = content.get("layout", {})
        layout = {}
        for panel_id, default_values in DEFAULT_LAYOUT.items():
            current = raw_layout.get(panel_id, {}) if isinstance(raw_layout, dict) else {}
            width = self._clamp_number(current.get("width"), default_values["width"], 0.1, 0.96)
            height = self._clamp_number(current.get("height"), default_values["height"], 0.1, 0.96)
            layout[panel_id] = {
                "x": self._clamp_number(current.get("x"), default_values["x"], 0, 1 - width),
                "y": self._clamp_number(current.get("y"), default_values["y"], 0, 1 - height),
                "width": width,
                "height": height,
                "z": max(1, int(self._clamp_number(current.get("z"), default_values["z"], 1, 999))),
            }
        normalized["layout"] = layout

        return normalized

    def load_legacy_content(self) -> dict[str, Any]:
        content = default_content()
        content["notes"], content["tasks"], content["layout"] = self._parse_legacy_storage()
        content["links"] = self._parse_legacy_links()
        return self.normalize_content(content)

    def _parse_legacy_storage(self) -> tuple[str, list[dict[str, Any]], dict[str, Any]]:
        storage_path = self.project_root / "storage.txt"
        if not storage_path.exists():
            return "", [], deepcopy(DEFAULT_LAYOUT)

        lines = storage_path.read_text(encoding="utf-8").splitlines()
        notes_lines = self._section_between(lines, "[NOTES]", "[/NOTES]")
        task_lines = self._section_between(lines, "[TASKS]", "[/TASKS]")
        layout_lines = self._section_between(lines, "[LAYOUT]", "[/LAYOUT]")

        tasks: list[dict[str, Any]] = []
        for line in task_lines:
            stripped = line.strip()
            if stripped.startswith("[x] "):
                tasks.append({"text": stripped[4:], "done": True})
            elif stripped.startswith("[ ] "):
                tasks.append({"text": stripped[4:], "done": False})

        layout: dict[str, Any] = deepcopy(DEFAULT_LAYOUT)
        raw_layout = "\n".join(layout_lines).strip()
        if raw_layout:
            try:
                parsed = json.loads(raw_layout)
                if isinstance(parsed, dict):
                    layout = parsed
            except json.JSONDecodeError:
                layout = deepcopy(DEFAULT_LAYOUT)

        return "\n".join(notes_lines).strip("\n"), tasks, layout

    def _parse_legacy_links(self) -> list[dict[str, str]]:
        link_path = self.project_root / "link.txt"
        if not link_path.exists():
            return []

        links: list[dict[str, str]] = []
        for index, raw_line in enumerate(link_path.read_text(encoding="utf-8").splitlines(), start=1):
            line = raw_line.strip()
            if not line or line.startswith("#"):
                continue

            if "|" in line:
                title, url = [part.strip() for part in line.split("|", 1)]
            else:
                title, url = f"Link {index}", line

            if url:
                links.append({"title": title or f"Link {index}", "url": url})

        return links

    @staticmethod
    def _section_between(lines: list[str], start_marker: str, end_marker: str) -> list[str]:
        start_index = None
        end_index = None

        for index, line in enumerate(lines):
            if line == start_marker:
                start_index = index + 1
            elif line == end_marker and start_index is not None:
                end_index = index
                break

        if start_index is None or end_index is None or end_index < start_index:
            return []

        return lines[start_index:end_index]

    @staticmethod
    def _clamp_number(value: Any, fallback: float, min_value: float, max_value: float) -> float:
        try:
            number = float(value)
        except (TypeError, ValueError):
            number = float(fallback)

        return max(min_value, min(number, max_value))
