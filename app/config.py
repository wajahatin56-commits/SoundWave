"""
config.py — application configuration.
"""

import os
import sys
from pathlib import Path


def _normalize_songs_dir(raw: str) -> Path:
    """Handle Windows-style paths from .env on Windows. /C:/foo → C:/foo"""
    if (
        raw
        and sys.platform == "win32"
        and raw.startswith("/")
        and len(raw) > 2
        and raw[2] == ":"
    ):
        raw = raw[1:]
    return Path(raw)


class Config:
    SECRET_KEY: str = os.environ.get("SECRET_KEY", "dev-key-change-in-prod")
    BASE_DIR: Path = Path(__file__).resolve().parent.parent

    _songs_env: str = os.environ.get("SONGS_DIR", "")
    SONGS_DIR: Path = _normalize_songs_dir(_songs_env) if _songs_env else BASE_DIR / "songs"

    THUMBNAIL_CACHE_SIZE: int = int(os.environ.get("THUMBNAIL_CACHE_SIZE", 200))
    LOG_LEVEL: str = os.environ.get("LOG_LEVEL", "INFO")

    # Flask-Compress
    COMPRESS_MIMETYPES: list = [
        "text/html",
        "text/css",
        "text/javascript",
        "application/json",
    ]
    COMPRESS_LEVEL: int = 6
    COMPRESS_MIN_SIZE: int = 500
    SEND_FILE_MAX_AGE_DEFAULT: int = 31536000  # 1 year for static assets

    # Database — SQLite with WAL mode enabled via event hook
    _db_path: str = os.environ.get("DB_PATH", str(BASE_DIR / "soundwave.db"))
    SQLALCHEMY_DATABASE_URI: str = f"sqlite:///{_db_path}"
    SQLALCHEMY_TRACK_MODIFICATIONS: bool = False
    SQLALCHEMY_ENGINE_OPTIONS: dict = {
        "connect_args": {"check_same_thread": False},
        "pool_pre_ping": True,
        "pool_size": 10,
        "max_overflow": 20,
    }

    # Auth
    SESSION_LIFETIME_DAYS: int = int(os.environ.get("SESSION_LIFETIME_DAYS", 30))
    BCRYPT_LOG_ROUNDS: int = int(os.environ.get("BCRYPT_LOG_ROUNDS", 12))
