import logging
import threading
import time
from collections import OrderedDict
from pathlib import Path

from mutagen.id3 import ID3, ID3NoHeaderError
from mutagen.mp3 import MP3
from mutagen.easyid3 import EasyID3

from .config import Config
from .utils import get_file_hash

logger = logging.getLogger(__name__)


class SongLibrary:
    """In-memory music library with lazy scanning and thread-safe LRU thumbnail cache."""

    def __init__(self) -> None:
        self.songs_dir: Path = Config.SONGS_DIR
        self._songs: list[dict] = []
        self._songs_by_id: dict[str, dict] = {}
        self._last_scan: float = 0.0
        self._scan_lock = threading.Lock()

        # Ordered dict acts as an LRU cache (Python 3.7+ preserves insertion order)
        self._thumb_cache: OrderedDict[str, bytes | None] = OrderedDict()
        self._thumb_lock = threading.Lock()
        self._thumb_cache_max: int = Config.THUMBNAIL_CACHE_SIZE

    # ── Directory change detection ─────────────────────────────────────────

    def _needs_rescan(self) -> bool:
        try:
            return self.songs_dir.stat().st_mtime > self._last_scan
        except OSError:
            return True

    # ── Metadata extraction ────────────────────────────────────────────────

    @staticmethod
    def _extract_metadata(filepath: Path) -> dict:
        meta: dict = {
            "id": get_file_hash(str(filepath)),
            "filename": filepath.name,
            "title": filepath.stem,
            "artist": "Unknown Artist",
            "album": "Unknown Album",
            "duration": 0,
            "has_thumbnail": False,
            "genre": "",
            "year": "",
        }
        try:
            meta["duration"] = int(MP3(filepath).info.length)
        except Exception:
            pass

        try:
            tags = ID3(filepath)
            if "TIT2" in tags:
                meta["title"] = str(tags["TIT2"]).strip() or meta["title"]
            if "TPE1" in tags:
                meta["artist"] = str(tags["TPE1"]).strip() or meta["artist"]
            if "TALB" in tags:
                meta["album"] = str(tags["TALB"]).strip() or meta["album"]
            if "TCON" in tags:
                meta["genre"] = str(tags["TCON"]).strip()
            if "TDRC" in tags:
                meta["year"] = str(tags["TDRC"]).strip()[:4]
            meta["has_thumbnail"] = any(k.startswith("APIC") for k in tags.keys())
        except ID3NoHeaderError:
            try:
                easy = EasyID3(filepath)
                if "title" in easy:
                    meta["title"] = easy["title"][0].strip() or meta["title"]
                if "artist" in easy:
                    meta["artist"] = easy["artist"][0].strip() or meta["artist"]
                if "album" in easy:
                    meta["album"] = easy["album"][0].strip() or meta["album"]
            except Exception:
                pass
        except Exception as exc:
            logger.warning("Error reading tags from %s: %s", filepath.name, exc)

        return meta

    # ── Library scan ───────────────────────────────────────────────────────

    def _scan_songs(self) -> tuple[list[dict], dict[str, dict]]:
        new_songs: list[dict] = []
        by_id: dict[str, dict] = {}
        if not self.songs_dir.exists():
            logger.warning("Songs directory does not exist: %s", self.songs_dir)
            return new_songs, by_id
        for filepath in sorted(self.songs_dir.glob("*.mp3")):
            try:
                meta = self._extract_metadata(filepath)
                new_songs.append(meta)
                by_id[meta["id"]] = meta
            except Exception as exc:
                logger.error("Failed to process %s: %s", filepath.name, exc)
        return new_songs, by_id

    def get_songs(self) -> list[dict]:
        if not self._needs_rescan():
            return self._songs
        with self._scan_lock:
            # Double-checked locking: another thread may have scanned while we waited
            if not self._needs_rescan():
                return self._songs
            self._songs, self._songs_by_id = self._scan_songs()
            self._last_scan = time.time()
            logger.info("Scanned %d songs from %s", len(self._songs), self.songs_dir)
        return self._songs

    def get_song_by_id(self, song_id: str) -> dict | None:
        self.get_songs()
        return self._songs_by_id.get(song_id)

    # ── Thumbnail cache (LRU via OrderedDict) ─────────────────────────────

    def _load_thumbnail_from_disk(self, song_id: str) -> bytes | None:
        song = self.get_song_by_id(song_id)
        if not song or not song.get("has_thumbnail"):
            return None
        filepath = self.songs_dir / song["filename"]
        try:
            tags = ID3(filepath)
            for key in tags.keys():
                if key.startswith("APIC"):
                    return tags[key].data
        except Exception as exc:
            logger.warning("Could not extract thumbnail for %s: %s", song["filename"], exc)
        return None

    def get_thumbnail(self, song_id: str) -> bytes | None:
        with self._thumb_lock:
            if song_id in self._thumb_cache:
                # Move to end (most-recently-used)
                self._thumb_cache.move_to_end(song_id)
                return self._thumb_cache[song_id]

        # Load outside lock to avoid blocking other thumbnail requests
        data = self._load_thumbnail_from_disk(song_id)

        with self._thumb_lock:
            # Evict least-recently-used entries if over capacity
            while len(self._thumb_cache) >= self._thumb_cache_max:
                self._thumb_cache.popitem(last=False)
            self._thumb_cache[song_id] = data
        return data


# Singleton library instance — shared across all requests
library = SongLibrary()
