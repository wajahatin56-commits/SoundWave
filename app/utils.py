import hashlib

_hash_cache: dict[str, str] = {}


def get_file_hash(filepath: str) -> str:
    """Return a short, stable MD5-based hash for a file path string."""
    h = _hash_cache.get(filepath)
    if h is None:
        h = hashlib.md5(filepath.encode(), usedforsecurity=False).hexdigest()[:12]
        _hash_cache[filepath] = h
    return h