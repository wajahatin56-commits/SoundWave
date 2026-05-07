"""
auth/models.py — SQLAlchemy ORM models.

DATETIME STRATEGY (CRITICAL):
  SQLite does not have a native timezone-aware datetime type.
  SQLAlchemy's DateTime(timezone=True) is a no-op for SQLite — values are
  stored as plain ISO strings and read back as NAIVE Python datetimes.

  Therefore we use naive UTC datetimes everywhere:
    - _utcnow() returns datetime.utcnow() (naive, UTC)
    - All DateTime columns use DateTime (no timezone=True)
    - All comparisons are naive vs naive — no TypeError possible

  This is the correct, standard approach for SQLite + SQLAlchemy.
  If migrating to PostgreSQL, switch to timezone.utc aware datetimes
  and update columns to DateTime(timezone=True).
"""

from __future__ import annotations

from datetime import datetime, timedelta
import secrets

from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()


def _utcnow() -> datetime:
    """Return current UTC time as a NAIVE datetime (correct for SQLite)."""
    return datetime.utcnow()


class User(db.Model):
    __tablename__ = "users"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    username = db.Column(db.String(64), unique=True, nullable=False, index=True)
    email = db.Column(db.String(254), unique=True, nullable=True, index=True)
    password_hash = db.Column(db.String(256), nullable=False)
    # Naive UTC datetime — consistent with SQLite storage behaviour
    created_at = db.Column(db.DateTime, nullable=False, default=_utcnow)

    liked_songs = db.relationship(
        "LikedSong",
        back_populates="user",
        cascade="all, delete-orphan",
        lazy="select",
        order_by="LikedSong.created_at",
    )
    sessions = db.relationship(
        "UserSession",
        back_populates="user",
        cascade="all, delete-orphan",
        lazy="select",
    )

    def to_public_dict(self) -> dict:
        return {
            "id": self.id,
            "username": self.username,
            "email": self.email,
            # isoformat() on a naive datetime — clients treat as UTC
            "created_at": self.created_at.isoformat() + "Z",
        }

    def __repr__(self) -> str:
        return f"<User id={self.id} username={self.username!r}>"


class LikedSong(db.Model):
    __tablename__ = "liked_songs"
    __table_args__ = (
        db.UniqueConstraint("user_id", "song_id", name="uq_liked_user_song"),
    )

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    user_id = db.Column(
        db.Integer,
        db.ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    song_id = db.Column(db.String(32), nullable=False, index=True)
    created_at = db.Column(db.DateTime, nullable=False, default=_utcnow)

    user = db.relationship("User", back_populates="liked_songs")

    def __repr__(self) -> str:
        return f"<LikedSong user_id={self.user_id} song_id={self.song_id!r}>"


class UserSession(db.Model):
    __tablename__ = "user_sessions"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    user_id = db.Column(
        db.Integer,
        db.ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    token = db.Column(db.String(128), unique=True, nullable=False, index=True)
    created_at = db.Column(db.DateTime, nullable=False, default=_utcnow)
    expires_at = db.Column(db.DateTime, nullable=False)

    user = db.relationship("User", back_populates="sessions")

    @classmethod
    def create_for(cls, user: "User", lifetime_days: int = 30) -> "UserSession":
        token = secrets.token_urlsafe(64)
        # Both sides naive UTC — consistent with _utcnow()
        expires = _utcnow() + timedelta(days=lifetime_days)
        return cls(user_id=user.id, token=token, expires_at=expires)

    def is_expired(self) -> bool:
        # naive UTC vs naive UTC — no TypeError possible
        return _utcnow() > self.expires_at

    def __repr__(self) -> str:
        return f"<UserSession user_id={self.user_id} expires_at={self.expires_at}>"