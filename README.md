# SoundWave 🎵

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Python](https://img.shields.io/badge/python-3.8%2B-blue)
![Flask](https://img.shields.io/badge/flask-2.0%2B-lightgrey)

A modern self-hosted music streaming platform built with Python and Flask.
SoundWave delivers a smooth Spotify-inspired experience with local music hosting, responsive UI, favorites, search, downloads, and a powerful fullscreen player.

---

## Features

- Modern dark-themed responsive UI
- Local music streaming
- Fullscreen music player
- Song search system
- Favorites / liked songs
- Download songs locally
- Volume and seek controls
- Dynamic music library
- Real-time playback controls
- Flask REST API backend
- Music metadata extraction
- Thumbnail support
- Authentication system
- Mobile-friendly interface

---

## Tech Stack

| Layer | Technologies |
|---|---|
| **Backend** | Python, Flask, Flask APIs, Mutagen |
| **Frontend** | HTML5, CSS3, JavaScript |
| **Storage** | SQLite, Local file storage |

---

## Project Structure

```
SoundWave/
│
├── app/
│   ├── services/
│   │   └── streaming.py
│   │
│   ├── static/
│   │   ├── app.js
│   │   ├── auth-init.js
│   │   ├── auth.css
│   │   └── style.css
│   │
│   ├── templates/
│   │
│   ├── __init__.py
│   ├── api.py
│   ├── config.py
│   ├── models.py
│   └── utils.py
│
├── instance/
├── songs/
├── .env
├── .gitignore
├── requirements.txt
├── run.py
└── run_prod.py
```

---

## Installation

### 1. Clone the Repository

```bash
git clone https://github.com/wajahatin56-commits/SoundWave.git
cd SoundWave
```

### 2. Create a Virtual Environment

**Windows**
```bash
python -m venv venv
venv\Scripts\activate
```

**Linux / macOS**
```bash
python3 -m venv venv
source venv/bin/activate
```

### 3. Install Dependencies

```bash
pip install -r requirements.txt
```

---

## Running the Application

**Development Mode**
```bash
python run.py
```

**Production Mode**
```bash
python run_prod.py
```

---

## Environment Variables

Create a `.env` file in the root directory:

```env
SECRET_KEY=your_secret_key
FLASK_ENV=development
```

---

## Screenshots

### Home Interface
![Home Interface](screenshots/home.png)

### Fullscreen Player
![Fullscreen Player](screenshots/full.png)

---

## API & Streaming

SoundWave uses a Flask-based REST API to:

- Stream audio files
- Fetch song metadata
- Handle authentication
- Manage favorites
- Serve thumbnails
- Deliver dynamic song libraries

---

## Future Improvements

- Playlist support
- Real-time synchronized lyrics
- User profiles
- Music recommendations
- Queue system
- Offline caching
- PWA support
- AI-powered recommendations

---

## Security Notes

- Do not expose your `.env` file publicly
- Keep secret keys private
- Use HTTPS in production
- Configure proper CORS and authentication before deployment

---

## Author

**Ahsan Raza** — Python Backend Developer & Creator of SoundWave

---

## License

This project is licensed under the [MIT License](LICENSE).

---

## ⭐ Star the Repository

If you find this project useful, consider giving it a star on GitHub!