"""
app/__init__.py — application factory.
"""

import logging
import os
import sqlite3
from logging.handlers import RotatingFileHandler

from flask import Flask
from flask_cors import CORS
from flask_compress import Compress
from sqlalchemy import event
from sqlalchemy.engine import Engine

from .config import Config
from .api import api_bp
from app.auth import auth_bp, db
from app.auth.extensions import bcrypt
from app.auth.decorators import _resolve_current_user


# ── SQLite pragmas: WAL mode + foreign keys (applied once per connection) ─────
@event.listens_for(Engine, "connect")
def _set_sqlite_pragma(dbapi_connection, connection_record):
    if isinstance(dbapi_connection, sqlite3.Connection):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA synchronous=NORMAL")
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.execute("PRAGMA cache_size=-8000")   # 8 MB page cache
        cursor.execute("PRAGMA temp_store=MEMORY")  # temp tables in RAM
        cursor.close()


def configure_logging(app: Flask) -> None:
    """Configure rotating-file + console logging (deduplication guarded)."""
    if app.logger.handlers:
        return

    log_level = getattr(logging, app.config.get("LOG_LEVEL", "INFO").upper(), logging.INFO)
    formatter = logging.Formatter("[%(asctime)s] %(levelname)s in %(module)s: %(message)s")

    console_handler = logging.StreamHandler()
    console_handler.setFormatter(formatter)
    console_handler.setLevel(log_level)

    log_dir = app.instance_path
    os.makedirs(log_dir, exist_ok=True)
    file_handler = RotatingFileHandler(
        os.path.join(log_dir, "soundwave.log"),
        maxBytes=10_485_760,
        backupCount=5,
    )
    file_handler.setFormatter(formatter)
    file_handler.setLevel(log_level)

    app.logger.addHandler(console_handler)
    app.logger.addHandler(file_handler)
    app.logger.setLevel(log_level)


def create_app(config_class=Config) -> Flask:
    app = Flask(
        __name__,
        static_folder="static",
        template_folder="templates",
        instance_relative_config=True,
    )
    app.config.from_object(config_class)

    # ── Extensions ─────────────────────────────────────────────────────────
    db.init_app(app)
    bcrypt.init_app(app)
    CORS(app, supports_credentials=True, origins=["http://localhost:5000"])
    Compress(app)

    configure_logging(app)

    # ── Blueprints ──────────────────────────────────────────────────────────
    app.register_blueprint(api_bp, url_prefix="/api")
    app.register_blueprint(auth_bp)

    # ── Database bootstrap ──────────────────────────────────────────────────
    with app.app_context():
        db.create_all()

    # ── Core routes ─────────────────────────────────────────────────────────
    @app.route("/")
    def index():
        from flask import render_template
        return render_template("index.html")

    @app.route("/health")
    def health():
        from app.auth.models import db as _db
        try:
            _db.session.execute(_db.text("SELECT 1"))
            return {"status": "ok"}
        except Exception:
            return {"status": "degraded"}, 500

    # ── Template context ────────────────────────────────────────────────────
    @app.context_processor
    def inject_user():
        user = _resolve_current_user()
        return {"current_user": user}

    # ── Security + performance headers ──────────────────────────────────────
    @app.after_request
    def add_headers(response):
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
        response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        # Allow SharedArrayBuffer for potential future AudioWorklet use
        response.headers.setdefault("Cross-Origin-Opener-Policy", "same-origin")
        return response

    return app
