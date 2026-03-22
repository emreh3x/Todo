from __future__ import annotations

import argparse
import sys
from pathlib import Path

from argon2 import PasswordHasher


PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from app_data import FocusDataStore  # noqa: E402


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Create a Focus app user")
    parser.add_argument("--username", required=True, help="Username to create")
    parser.add_argument("--password", required=True, help="Password for the user")
    parser.add_argument("--admin", action="store_true", help="Mark the user as admin")
    parser.add_argument(
        "--migrate-legacy",
        action="store_true",
        help="Seed the new user with legacy storage.txt and link.txt content",
    )
    parser.add_argument(
        "--data-dir",
        default=None,
        help="Optional custom data directory (defaults to ./data)",
    )
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    store = FocusDataStore(project_root=PROJECT_ROOT, data_root=args.data_dir)
    password_hash = PasswordHasher().hash(args.password)

    try:
        user = store.create_user(
            args.username,
            password_hash,
            is_admin=args.admin,
            migrate_legacy=args.migrate_legacy,
        )
    except ValueError as exc:
        parser.error(str(exc))
        return 2

    print(f"Created user: {user['username']}")
    print(f"Admin: {'yes' if user['is_admin'] else 'no'}")
    print(f"Data root: {store.data_root}")
    if args.migrate_legacy:
        print("Legacy data migrated into the new account.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
