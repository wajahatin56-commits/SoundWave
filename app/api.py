"""
api.py — REST API blueprint.
"""

import hashlib
import logging

from flask import Blueprint, jsonify, request, abort, Response, g
from sqlalchemy import select

from .models import library
from .services.streaming import stream_audio_file
from .config import Config
from app.auth.decorators import login_required
from app.auth.models import LikedSong, db

api_bp = Blueprint("api", __name__)
logger = logging.getLogger(__name__)

# ── Song list ─────────────────────────────────────────────────────────────────

@api_bp.route("/songs")
def get_songs():
    """Return the full song list as JSON with short cache lifetime."""
    try:
        songs = library.get_songs()
        resp = jsonify(songs)
        # Allow clients/proxies to cache for 30 s; revalidate with 304 support
        resp.headers["Cache-Control"] = "public, max-age=30, must-revalidate"
        return resp
    except Exception:
        logger.exception("Error fetching songs")
        return jsonify({"error": "Internal server error"}), 500


# ── Thumbnail ─────────────────────────────────────────────────────────────────

@api_bp.route("/thumbnail/<song_id>")
def get_thumbnail(song_id: str):
    """Serve embedded album art with ETag-based conditional caching."""
    # Reject obviously invalid IDs early
    if not song_id or len(song_id) > 32 or not song_id.isalnum():
        abort(400)

    try:
        data = library.get_thumbnail(song_id)
        if data is None:
            abort(404)

        etag = f'"{hashlib.md5(f"{song_id}:{len(data)}".encode(), usedforsecurity=False).hexdigest()}"'

        if request.headers.get("If-None-Match") == etag:
            return Response(status=304)

        return Response(
            data,
            mimetype="image/jpeg",
            headers={
                "Cache-Control": "public, max-age=86400, immutable",
                "ETag": etag,
                "Vary": "Accept-Encoding",
            },
        )
    except Exception:
        logger.exception("Error serving thumbnail for %s", song_id)
        abort(500)


# ── Audio stream ──────────────────────────────────────────────────────────────

@api_bp.route("/stream/<song_id>")
def stream_song(song_id: str):
    """Stream audio with HTTP Range support."""
    if not song_id or len(song_id) > 32:
        abort(400)
    try:
        song = library.get_song_by_id(song_id)
        if not song:
            abort(404)
        filepath = Config.SONGS_DIR / song["filename"]
        return stream_audio_file(filepath)
    except Exception:
        logger.exception("Error streaming %s", song_id)
        abort(500)


# ── User likes (authenticated) ────────────────────────────────────────────────

@api_bp.route("/user/likes", methods=["GET"])
@login_required
def get_user_likes():
    """GET /api/user/likes — returns list of liked song IDs for current user."""
    user = g.current_user
    rows = (
        db.session.execute(
            select(LikedSong.song_id)
            .where(LikedSong.user_id == user.id)
            .order_by(LikedSong.created_at)
        )
        .scalars()
        .all()
    )
    return jsonify({"liked": rows}), 200


@api_bp.route("/user/likes", methods=["POST"])
@login_required
def add_user_like():
    """POST /api/user/likes — body: { song_id: string } — adds a like (idempotent)."""
    user = g.current_user
    data = request.get_json(silent=True) or {}
    song_id = (data.get("song_id") or "").strip()
    if not song_id:
        return jsonify({"error": "song_id is required"}), 400
    if len(song_id) > 64:
        return jsonify({"error": "Invalid song_id"}), 400

    existing = LikedSong.query.filter_by(user_id=user.id, song_id=song_id).first()
    if existing:
        return jsonify({"ok": True, "created": False}), 200

    like = LikedSong(user_id=user.id, song_id=song_id)
    try:
        db.session.add(like)
        db.session.commit()
    except Exception:
        db.session.rollback()
        logger.exception("Failed to add like for user %s song %s", user.id, song_id)
        return jsonify({"error": "Could not save liked song"}), 500
    return jsonify({"ok": True, "created": True}), 201


@api_bp.route("/user/likes/<song_id>", methods=["DELETE"])
@login_required
def remove_user_like(song_id: str):
    """DELETE /api/user/likes/<song_id> — removes a like (idempotent)."""
    user = g.current_user
    try:
        LikedSong.query.filter_by(user_id=user.id, song_id=song_id).delete()
        db.session.commit()
    except Exception:
        db.session.rollback()
        logger.exception("Failed to remove like for user %s song %s", user.id, song_id)
        return jsonify({"error": "Could not remove liked song"}), 500
    return jsonify({"ok": True}), 200


@api_bp.route("/user/likes/sync", methods=["POST"])
@login_required
def sync_user_likes():
    """POST /api/user/likes/sync — body: { song_ids: string[] } — bulk sync."""
    user = g.current_user
    data = request.get_json(silent=True) or {}
    incoming = [
        s.strip()
        for s in (data.get("song_ids") or [])
        if isinstance(s, str) and s.strip() and len(s.strip()) <= 64
    ]

    if incoming:
        existing_ids: set[str] = set(
            db.session.execute(
                select(LikedSong.song_id).where(LikedSong.user_id == user.id)
            )
            .scalars()
            .all()
        )
        new_rows = [
            LikedSong(user_id=user.id, song_id=sid)
            for sid in incoming
            if sid not in existing_ids
        ]
        if new_rows:
            try:
                db.session.add_all(new_rows)
                db.session.commit()
            except Exception:
                db.session.rollback()
                logger.exception("Bulk sync failed for user %s", user.id)
                return jsonify({"error": "Sync failed"}), 500

    all_ids = (
        db.session.execute(
            select(LikedSong.song_id)
            .where(LikedSong.user_id == user.id)
            .order_by(LikedSong.created_at)
        )
        .scalars()
        .all()
    )
    return jsonify({"liked": list(all_ids)}), 200
