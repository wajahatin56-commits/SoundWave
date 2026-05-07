from dotenv import load_dotenv
load_dotenv()

from app import create_app

app = create_app()

if __name__ == "__main__":
    import os
    print("SoundWave Development Server")
    print(f"Songs directory: {app.config['SONGS_DIR']}")
    print("Open: http://localhost:5000")
    app.run(host="0.0.0.0", port=5000, debug=False, threaded=True)
