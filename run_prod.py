import os
from dotenv import load_dotenv
load_dotenv()

from app import create_app

app = create_app()

if not os.environ.get("GUNICORN_CMD_ARGS"):
    from waitress import serve
    print("SoundWave Production Server (Waitress)")
    serve(app, host="0.0.0.0", port=5000, threads=8)
