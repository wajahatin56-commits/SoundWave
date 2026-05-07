import logging
import re
from pathlib import Path

from flask import request, Response, abort

logger = logging.getLogger(__name__)

# 256 KB chunks — sweet spot for MP3 streaming latency vs. syscall overhead
_CHUNK_SIZE = 262_144
_RANGE_RE = re.compile(r"bytes=(\d*)-(\d*)", re.ASCII)

# Common cache-control headers for audio streams (no caching — live seek support)
_STREAM_HEADERS = {
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
}


def stream_audio_file(filepath: Path) -> Response:
    """Stream an MP3 file with HTTP/1.1 Range support and optimised chunking."""
    if not filepath.exists():
        logger.warning("Stream requested for missing file: %s", filepath)
        abort(404)

    try:
        file_size: int = filepath.stat().st_size
    except OSError:
        logger.error("Cannot stat file: %s", filepath)
        abort(500)

    range_header: str | None = request.headers.get("Range")

    if not range_header:
        # Full file — stream without loading into memory
        def _generate_full():
            with filepath.open("rb") as fh:
                while chunk := fh.read(_CHUNK_SIZE):
                    yield chunk

        return Response(
            _generate_full(),
            status=200,
            mimetype="audio/mpeg",
            headers={**_STREAM_HEADERS, "Content-Length": str(file_size)},
        )

    # ── Range request ──────────────────────────────────────────────────────
    m = _RANGE_RE.match(range_header.strip())
    if not m:
        logger.warning("Malformed Range header: %r", range_header)
        abort(416)

    start_str, end_str = m.group(1), m.group(2)

    try:
        byte_start = int(start_str) if start_str else 0
        byte_end   = int(end_str)   if end_str   else file_size - 1
    except ValueError:
        abort(416)

    byte_end = min(byte_end, file_size - 1)

    if byte_start >= file_size or byte_start > byte_end:
        abort(416)

    length = byte_end - byte_start + 1

    def _generate_chunk():
        remaining = length
        with filepath.open("rb") as fh:
            fh.seek(byte_start)
            while remaining > 0:
                data = fh.read(min(_CHUNK_SIZE, remaining))
                if not data:
                    break
                yield data
                remaining -= len(data)

    return Response(
        _generate_chunk(),
        status=206,
        mimetype="audio/mpeg",
        headers={
            **_STREAM_HEADERS,
            "Content-Range": f"bytes {byte_start}-{byte_end}/{file_size}",
            "Content-Length": str(length),
        },
    )
