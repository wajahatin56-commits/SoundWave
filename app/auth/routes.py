"""
auth/routes.py — Authentication blueprint.

DATETIME NOTE:
  Uses datetime.utcnow() (naive UTC) everywhere to match the database
  storage strategy. See auth/models.py for full explanation.
"""

from __future__ import annotations

import logging
import re
from datetime import datetime

from flask import (
    Blueprint,
    current_app,
    jsonify,
    make_response,
    redirect,
    render_template,
    request,
    url_for,
)

from .decorators import _resolve_current_user
from .models import User, UserSession, db
from .extensions import bcrypt

logger = logging.getLogger(__name__)
auth_bp = Blueprint("auth", __name__)

# ── Validation constants ──────────────────────────────────────────────────────
_USERNAME_RE = re.compile(r"^[A-Za-z0-9_\-]{3,32}$")
_EMAIL_RE = re.compile(r"^[a-zA-Z0-9_.+\-]+@[a-zA-Z0-9\-]+\.[a-zA-Z0-9\-.]+$")
_MIN_PW_LEN = 8
_MAX_PW_LEN = 128
_SESSION_COOKIE = "sw_session"


def _cookie_max_age() -> int:
    """Return cookie max-age in seconds from config."""
    days = current_app.config.get("SESSION_LIFETIME_DAYS", 30)
    return int(days) * 86_400


def _set_session_cookie(response, token: str) -> None:
    response.set_cookie(
        _SESSION_COOKIE,
        token,
        max_age=_cookie_max_age(),
        httponly=True,
        samesite="Lax",
        # secure=True  # Uncomment when running behind HTTPS in production
    )


def _clear_session_cookie(response) -> None:
    response.delete_cookie(_SESSION_COOKIE, samesite="Lax")


def _validate_username(username: str) -> str | None:
    if not username:
        return "Username is required."
    if not _USERNAME_RE.match(username):
        return "Username must be 3–32 characters: letters, digits, _ or -"
    return None


def _validate_password(password: str) -> str | None:
    if not password:
        return "Password is required."
    if len(password) < _MIN_PW_LEN:
        return f"Password must be at least {_MIN_PW_LEN} characters."
    if len(password) > _MAX_PW_LEN:
        return f"Password must be at most {_MAX_PW_LEN} characters."
    return None


def _prune_expired_sessions(user: User) -> None:
    """Delete expired sessions for a user. Non-fatal if it fails."""
    try:
        # datetime.utcnow() — naive UTC, matches DB storage
        now = datetime.utcnow()
        deleted = UserSession.query.filter(
            UserSession.user_id == user.id,
            UserSession.expires_at < now,
        ).delete(synchronize_session=False)
        db.session.commit()
        if deleted:
            logger.debug("Pruned %d expired sessions for user %s", deleted, user.id)
    except Exception:
        db.session.rollback()
        logger.warning("Failed to prune expired sessions for user %s", user.id)


# ── Page routes ───────────────────────────────────────────────────────────────

@auth_bp.route("/login")
def login_page():
    if _resolve_current_user():
        return redirect(url_for("index"))
    return render_template("auth.html", initial_tab="login")


@auth_bp.route("/register")
def register_page():
    if _resolve_current_user():
        return redirect(url_for("index"))
    return render_template("auth.html", initial_tab="register")


# ── API routes ────────────────────────────────────────────────────────────────

@auth_bp.route("/auth/register", methods=["POST"])
def register():
    data = request.get_json(silent=True) or {}
    username = (data.get("username") or "").strip()
    password = data.get("password") or ""
    email = (data.get("email") or "").strip() or None

    err = _validate_username(username)
    if err:
        return jsonify({"error": err}), 400
    err = _validate_password(password)
    if err:
        return jsonify({"error": err}), 400
    if email and not _EMAIL_RE.match(email):
        return jsonify({"error": "Invalid email address."}), 400

    if User.query.filter(db.func.lower(User.username) == username.lower()).first():
        return jsonify({"error": "Username is already taken."}), 409
    if email and User.query.filter(db.func.lower(User.email) == email.lower()).first():
        return jsonify({"error": "Email is already registered."}), 409

    rounds = current_app.config.get("BCRYPT_LOG_ROUNDS", 12)
    pw_hash = bcrypt.generate_password_hash(password, rounds=rounds).decode("utf-8")

    user = User(username=username, email=email, password_hash=pw_hash)
    try:
        db.session.add(user)
        db.session.flush()  # assigns user.id before commit

        lifetime = current_app.config.get("SESSION_LIFETIME_DAYS", 30)
        session_row = UserSession.create_for(user, lifetime_days=lifetime)
        db.session.add(session_row)
        db.session.commit()
    except Exception:
        db.session.rollback()
        logger.exception("Registration failed for %s", username)
        return jsonify({"error": "Registration failed. Please try again."}), 500

    resp = make_response(jsonify({"user": user.to_public_dict()}), 201)
    _set_session_cookie(resp, session_row.token)
    return resp


@auth_bp.route("/auth/login", methods=["POST"])
def login():
    data = request.get_json(silent=True) or {}
    identifier = (data.get("username") or "").strip()
    password = data.get("password") or ""

    if not identifier or not password:
        return jsonify({"error": "Username and password are required."}), 400

    user = User.query.filter(
        db.func.lower(User.username) == identifier.lower()
    ).first()
    if not user:
        user = User.query.filter(
            db.func.lower(User.email) == identifier.lower()
        ).first()

    if not user or not bcrypt.check_password_hash(user.password_hash, password):
        return jsonify({"error": "Invalid credentials."}), 401

    _prune_expired_sessions(user)

    lifetime = current_app.config.get("SESSION_LIFETIME_DAYS", 30)
    session_row = UserSession.create_for(user, lifetime_days=lifetime)
    try:
        db.session.add(session_row)
        db.session.commit()
    except Exception:
        db.session.rollback()
        logger.exception("Login failed for user %s", user.id)
        return jsonify({"error": "Login failed. Please try again."}), 500

    resp = make_response(jsonify({"user": user.to_public_dict()}), 200)
    _set_session_cookie(resp, session_row.token)
    return resp


@auth_bp.route("/auth/logout", methods=["POST"])
def logout():
    token = request.cookies.get(_SESSION_COOKIE)
    if token:
        try:
            UserSession.query.filter_by(token=token).delete()
            db.session.commit()
        except Exception:
            db.session.rollback()
            logger.warning("Failed to delete session token on logout")
    resp = make_response(jsonify({"ok": True}), 200)
    _clear_session_cookie(resp)
    return resp


@auth_bp.route("/auth/me")
def me():
    user = _resolve_current_user()
    if user is None:
        return jsonify({"user": None}), 200
    return jsonify({"user": user.to_public_dict()}), 200