"""
auth/decorators.py — request-level auth guard.
"""

from __future__ import annotations

import logging
from functools import wraps
from typing import Callable

from flask import g, request, jsonify, redirect, url_for

logger = logging.getLogger(__name__)


def _resolve_current_user():
    """
    Load the authenticated user from the session cookie.

    Results are cached on Flask's request-context `g` object so this
    function can be called multiple times per request without extra DB hits.

    Returns the User ORM instance, or None if unauthenticated / expired.
    """
    if hasattr(g, "_auth_resolved"):
        return g.current_user  # type: ignore[attr-defined]

    g._auth_resolved = True
    g.current_user = None

    token = request.cookies.get("sw_session")
    if not token:
        return None

    # Inline import to break circular import at module load time
    from .models import UserSession, db

    session_row = UserSession.query.filter_by(token=token).first()
    if session_row is None:
        return None

    # is_expired() now compares naive UTC vs naive UTC — no TypeError
    if session_row.is_expired():
        try:
            db.session.delete(session_row)
            db.session.commit()
        except Exception:
            db.session.rollback()
        return None

    g.current_user = session_row.user
    return g.current_user


def login_required(f: Callable) -> Callable:
    """
    Decorator that enforces authentication.
    - /api/* paths → JSON 401
    - All other paths → redirect to /login
    """
    @wraps(f)
    def wrapper(*args, **kwargs):
        user = _resolve_current_user()
        if user is None:
            wants_json = (
                request.path.startswith("/api/")
                or "application/json" in request.headers.get("Accept", "")
            )
            if wants_json:
                return jsonify({"error": "Authentication required"}), 401
            return redirect(url_for("auth.login_page"))
        return f(*args, **kwargs)
    return wrapper


def current_user():
    """Public helper — returns the authenticated User for this request, or None."""
    return _resolve_current_user()