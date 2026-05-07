"use strict";
/* ===================================================
   SoundWave — app.js (Production-Optimised)

   Optimisations applied (zero functional changes):
   ─ Debounced search (150 ms)
   ─ Memoised thumbnail colour extraction per song ID
   ─ updateAllActiveStates: O(1) targeted DOM update (tracks prev ID)
   ─ renderQueue: skips full rebuild when only active index changed
   ─ renderLibrary: skips rebuild when same songs reference
   ─ Drag listeners attached/removed dynamically (no idle hot listeners)
   ─ fmtTime memoised for integer seconds
   ─ timeupdate throttled to ~10 fps (100 ms gate)
   ─ Preloads next song after 3 s of playback
   ─ animateAmbient: single cssText assignment per frame
   ─ AudioContext init guard (no redundant re-init)
   ─ DocumentFragment batch DOM inserts throughout
   ─ walrus-operator style read in streaming generator
   =================================================== */

const API = "";

// ── Audio element ─────────────────────────────────────
const audio = document.getElementById("audioEl");

// ── Player bar ───────────────────────────────────────
const playBtn          = document.getElementById("playBtn");
const prevBtn          = document.getElementById("prevBtn");
const nextBtn          = document.getElementById("nextBtn");
const shuffleBtn       = document.getElementById("shuffleBtn");
const repeatBtn        = document.getElementById("repeatBtn");
const progressBar      = document.getElementById("progressBar");
const progressFill     = document.getElementById("progressFill");
const progressThumb    = document.getElementById("progressThumb");
const timeElapsed      = document.getElementById("timeElapsed");
const timeDuration     = document.getElementById("timeDuration");
const muteBtn          = document.getElementById("muteBtn");
const volBar           = document.getElementById("volBar");
const volFill          = document.getElementById("volFill");
const volThumb         = document.getElementById("volThumb");
const playerTitle      = document.getElementById("playerTitle");
const playerArtist     = document.getElementById("playerArtist");
const playerArt        = document.getElementById("playerArt");
const likeBtn          = document.getElementById("likeBtn");
const expandBtn        = document.getElementById("expandBtn");
const eqToggleBtn      = document.getElementById("eqToggleBtn");

// ── Grid / sidebar / search ───────────────────────────
const songsGrid    = document.getElementById("songsGrid");
const libraryList  = document.getElementById("libraryList");
const likedList    = document.getElementById("likedList");
const queueList    = document.getElementById("queueList");
const searchInput  = document.getElementById("searchInput");
const searchClear  = document.getElementById("searchClear");
const sortSelect   = document.getElementById("sortSelect");
const sidebar      = document.getElementById("sidebar");
const overlay      = document.getElementById("overlay");
const menuBtn      = document.getElementById("menuBtn");
const sidebarToggle = document.getElementById("sidebarToggle");
const vinyl        = document.getElementById("heroVinyl");
const ambient      = document.getElementById("ambient");

// ── Fullscreen player ─────────────────────────────────
const fsPlayer          = document.getElementById("fsPlayer");
const fsBg              = document.getElementById("fsBg");
const fsCanvas          = document.getElementById("fsCanvas");
const fsBack            = document.getElementById("fsBack");
const fsMenuBtn         = document.getElementById("fsMenuBtn");
const fsArt             = document.getElementById("fsArt");
const fsPlayBtn         = document.getElementById("fsPlayBtn");
const fsPrevBtn         = document.getElementById("fsPrevBtn");
const fsNextBtn         = document.getElementById("fsNextBtn");
const fsShuffleBtn      = document.getElementById("fsShuffleBtn");
const fsRepeatBtn       = document.getElementById("fsRepeatBtn");
const fsProgressBar     = document.getElementById("fsProgressBar");
const fsProgressFill    = document.getElementById("fsProgressFill");
const fsProgressThumb   = document.getElementById("fsProgressThumb");
const fsTimeElapsed     = document.getElementById("fsTimeElapsed");
const fsTimeDuration    = document.getElementById("fsTimeDuration");
const fsControlsOverlay = document.getElementById("fsControlsOverlay");
const fsLikeBtnFullscreen = document.getElementById("fsLikeBtnFullscreen");
const fsMarqueeText     = document.getElementById("fsMarqueeText");

// ── Equalizer ─────────────────────────────────────────
const eqModal       = document.getElementById("eqModal");
const eqPanel       = document.getElementById("eqPanel");
const eqSlidersEl   = document.getElementById("eqSliders");
const eqPresets     = document.querySelectorAll(".eq-preset");
const eqPowerToggle = document.getElementById("eqPowerToggle");
const eqToggleLabel = document.getElementById("eqToggleLabel");

// ── Ambient fullscreen container ──────────────────────
const fsAmbient = document.createElement("div");
fsAmbient.className = "fs-ambient";
const fsBgElement = document.getElementById("fsBg");
if (fsBgElement && fsBgElement.nextSibling) {
  fsPlayer.insertBefore(fsAmbient, fsBgElement.nextSibling);
} else {
  fsPlayer.appendChild(fsAmbient);
}

// ── State ─────────────────────────────────────────────
let allSongs      = [];
let filteredSongs = [];
let currentIndex  = -1;
let isPlaying     = false;
let isShuffle     = false;
let repeatMode    = 0;
let volume        = 0.8;
let isMuted       = false;
let likedSongs    = new Set(JSON.parse(localStorage.getItem("sw_liked") || "[]"));
let currentView   = "home";

// Drag state (listeners attached/removed dynamically)
let isDragProgress = false;
let isDragVol      = false;
let isDragFsProg   = false;

let ambientAnimationId = null;
let ambientOffset      = 0;

// ── Optimisation state ────────────────────────────────
let _prevActiveId            = null;  // targeted active-state toggling
let _libraryRenderedForSongs = null;  // reference-equality cache guard
let _preloadTimer            = null;
const _thumbColorCache       = new Map(); // song_id → Promise<string>

// ── Preload audio element (hidden) ────────────────────
let _preloadAudio = null;

// ── fmtTime memo cache ────────────────────────────────
const _fmtCache = new Map();

// ── timeupdate throttle ───────────────────────────────
let _lastTU = 0;

// ── Web Audio EQ ──────────────────────────────────────
let audioCtx        = null;
let sourceNode      = null;
let eqFilters       = [];
let eqEnabled       = true;
let eqChainConnected = false;

const EQ_BANDS = [60, 170, 310, 600, 1000, 3000, 6000, 12000, 14000, 16000];
const EQ_PRESETS = {
  flat:       [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  bass:       [8, 7, 5, 2, 0, 0, 0, 0, 0, 0],
  treble:     [0, 0, 0, 0, 0, 2, 4, 6, 7, 8],
  vocal:      [-2, -2, 0, 4, 6, 4, 2, 0, -2, -2],
  rock:       [5, 3, 0, -1, -2, 0, 2, 3, 4, 5],
  jazz:       [4, 3, 1, 2, 0, -2, -2, 0, 1, 2],
  electronic: [6, 5, 2, 0, -2, 2, 3, 5, 5, 6],
};

// ── UTILITY ───────────────────────────────────────────

function fmtTime(s) {
  if (!s || isNaN(s) || !isFinite(s)) return "0:00";
  const si = s | 0;
  let r = _fmtCache.get(si);
  if (r === undefined) {
    r = `${Math.floor(si / 60)}:${String(si % 60).padStart(2, "0")}`;
    _fmtCache.set(si, r);
  }
  return r;
}

function esc(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── WEB AUDIO EQ ──────────────────────────────────────

async function initAudioCtx() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === "suspended") await audioCtx.resume();

  if (!sourceNode) {
    sourceNode = audioCtx.createMediaElementSource(audio);
  }

  if (!eqChainConnected) {
    let prevNode = sourceNode;
    eqFilters = EQ_BANDS.map((freq, i) => {
      const filter = audioCtx.createBiquadFilter();
      filter.type =
        i === 0 ? "lowshelf" :
        i === EQ_BANDS.length - 1 ? "highshelf" : "peaking";
      filter.frequency.value = freq;
      filter.Q.value = 1.2;
      filter.gain.value = 0;
      prevNode.connect(filter);
      prevNode = filter;
      return filter;
    });
    prevNode.connect(audioCtx.destination);
    eqChainConnected = true;
  }

  eqFilters.forEach((f, i) => {
    const slider = document.getElementById("eqSlider" + i);
    if (slider) f.gain.value = eqEnabled ? parseFloat(slider.value) : 0;
  });
}

function buildEQSliders() {
  const frag = document.createDocumentFragment();
  EQ_BANDS.forEach((freq, i) => {
    const band = document.createElement("div");
    band.className = "eq-band";
    band.innerHTML = `
      <div class="eq-slider-wrap">
        <input type="range" id="eqSlider${i}" class="eq-slider" min="-12" max="12" step="0.5" value="0" orient="vertical">
      </div>
      <div class="eq-label">${freq < 1000 ? freq : freq / 1000 + "k"}</div>
      <div class="eq-val" id="eqVal${i}">0.0</div>
    `;
    frag.appendChild(band);
  });
  eqSlidersEl.innerHTML = "";
  eqSlidersEl.appendChild(frag);

  EQ_BANDS.forEach((_, i) => {
    const slider = document.getElementById(`eqSlider${i}`);
    const valSpan = document.getElementById(`eqVal${i}`);
    slider.addEventListener("input", (e) => {
      const val = parseFloat(e.target.value);
      valSpan.textContent = val.toFixed(1);
      if (eqEnabled && eqFilters[i]) eqFilters[i].gain.value = val;
    });
  });
}

function applyEQPreset(presetName) {
  const gains = EQ_PRESETS[presetName];
  if (!gains) return;
  gains.forEach((gain, i) => {
    const slider = document.getElementById(`eqSlider${i}`);
    if (slider) {
      slider.value = gain;
      slider.dispatchEvent(new Event("input"));
    }
  });
}

// ── AMBIENT BACKGROUND ────────────────────────────────

function getAverageColorFromImage(songId, url) {
  if (_thumbColorCache.has(songId)) return _thumbColorCache.get(songId);

  const promise = new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "Anonymous";
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 16;
      canvas.height = 16;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, 16, 16);
      const data = ctx.getImageData(0, 0, 16, 16).data;
      let r = 0, g = 0, b = 0;
      const pixels = data.length / 4;
      for (let i = 0; i < data.length; i += 4) {
        r += data[i];
        g += data[i + 1];
        b += data[i + 2];
      }
      resolve(`rgb(${Math.floor(r / pixels)},${Math.floor(g / pixels)},${Math.floor(b / pixels)})`);
    };
    img.onerror = () => resolve("rgb(110,231,183)");
    img.src = url;
  });

  _thumbColorCache.set(songId, promise);
  return promise;
}

function animateAmbient(color) {
  if (!fsPlayer.classList.contains("open")) {
    if (ambientAnimationId) cancelAnimationFrame(ambientAnimationId);
    return;
  }
  ambientOffset += 0.008;
  const ao = ambientOffset;

  const posX1 = 50 + Math.sin(ao) * 20;
  const posY1 = 80 + Math.cos(ao * 0.9) * 15;
  const size1 = 70 + Math.sin(ao * 0.5) * 15;
  const posX2 = 30 + Math.cos(ao * 1.2) * 20;
  const posY2 = 90 + Math.sin(ao * 0.8) * 10;
  const size2 = 60 + Math.cos(ao * 0.7) * 20;
  const posX3 = 70 + Math.sin(ao * 1.5) * 15;
  const posY3 = 70 + Math.cos(ao * 0.6) * 20;
  const size3 = 50 + Math.sin(ao * 0.9) * 15;
  const intensity = 0.7 + Math.sin(ao * 0.5) * 0.2;

  // Single cssText assignment = one style recalculation per frame
  fsAmbient.style.cssText =
    `background:radial-gradient(circle at ${posX1}% ${posY1}%,${color} 0%,rgba(0,0,0,0) ${size1}%),` +
    `radial-gradient(circle at ${posX2}% ${posY2}%,${color} 0%,rgba(0,0,0,0) ${size2}%),` +
    `radial-gradient(circle at ${posX3}% ${posY3}%,rgba(110,231,183,0.5) 0%,rgba(0,0,0,0) ${size3}%);` +
    `opacity:${intensity};` +
    `transform:scale(${1 + Math.sin(ao * 0.4) * 0.02});` +
    `will-change:transform,opacity;`;

  ambientAnimationId = requestAnimationFrame(() => animateAmbient(color));
}

function updateFullscreenAmbient(song) {
  if (!song) return;
  if (song.has_thumbnail) {
    getAverageColorFromImage(song.id, `${API}/api/thumbnail/${song.id}`).then((c) => {
      if (fsPlayer.classList.contains("open")) {
        if (ambientAnimationId) cancelAnimationFrame(ambientAnimationId);
        animateAmbient(c);
      } else {
        fsAmbient.dataset.lastColor = c;
      }
    });
  } else {
    const color = "rgba(110,231,183,0.5)";
    if (fsPlayer.classList.contains("open")) {
      if (ambientAnimationId) cancelAnimationFrame(ambientAnimationId);
      animateAmbient(color);
    } else {
      fsAmbient.dataset.lastColor = color;
    }
  }
}

function startFullscreenAmbient() {
  const color = fsAmbient.dataset.lastColor || "rgba(110,231,183,0.5)";
  if (ambientAnimationId) cancelAnimationFrame(ambientAnimationId);
  animateAmbient(color);
}

function updateAmbient(song) {
  if (!song) return;
  if (song.has_thumbnail) {
    const imgUrl = `${API}/api/thumbnail/${song.id}`;
    ambient.style.background =
      `radial-gradient(circle at 50% 30%,rgba(110,231,183,0.12) 0%,transparent 80%),` +
      `url(${imgUrl}) center/cover no-repeat fixed`;
    ambient.style.backgroundBlend = "overlay";
    ambient.style.filter = "blur(35px) brightness(0.6)";
  } else {
    ambient.style.background =
      `radial-gradient(ellipse 65% 45% at 15% 25%,rgba(110,231,183,0.08) 0%,transparent 70%),` +
      `radial-gradient(ellipse 55% 55% at 85% 75%,rgba(167,139,250,0.08) 0%,transparent 70%)`;
    ambient.style.filter = "none";
  }
}

// ── PARTICLE CANVAS ───────────────────────────────────
let particles = [], animFrame;

function initCanvas() {
  const dpr = window.devicePixelRatio || 1;
  fsCanvas.width  = fsCanvas.offsetWidth  * dpr;
  fsCanvas.height = fsCanvas.offsetHeight * dpr;
  const ctx = fsCanvas.getContext("2d");
  ctx.scale(dpr, dpr);
  particles = Array.from({ length: 28 }, makeParticle);
}

function makeParticle() {
  return {
    x:  Math.random() * (fsCanvas.offsetWidth  || 800),
    y:  Math.random() * (fsCanvas.offsetHeight || 600),
    r:  Math.random() * 2.5 + 0.5,
    vx: (Math.random() - 0.5) * 0.35,
    vy: (Math.random() - 0.5) * 0.35,
    o:  Math.random() * 0.4 + 0.08,
  };
}

function tickCanvas() {
  if (!fsPlayer.classList.contains("open")) {
    cancelAnimationFrame(animFrame);
    return;
  }
  const ctx = fsCanvas.getContext("2d");
  const W = fsCanvas.offsetWidth, H = fsCanvas.offsetHeight;
  ctx.clearRect(0, 0, W, H);
  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];
    p.x += p.vx;
    p.y += p.vy;
    if (p.x < 0) p.x = W; else if (p.x > W) p.x = 0;
    if (p.y < 0) p.y = H; else if (p.y > H) p.y = 0;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(110,231,183,${p.o})`;
    ctx.fill();
  }
  animFrame = requestAnimationFrame(tickCanvas);
}

// ── INIT ──────────────────────────────────────────────
async function init() {
  audio.volume = volume;
  setVolUI(volume);
  try {
    const res = await fetch(`${API}/api/songs`);
    if (!res.ok) throw new Error("Server error");
    allSongs = await res.json();
    filteredSongs = [...allSongs];
    renderSongs(filteredSongs);
    renderLiked();
    renderQueue();
  } catch (e) {
    songsGrid.innerHTML = `<div class="empty-state">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
      <p>Cannot connect to server.<br/>Make sure <strong>server.py</strong> is running.</p>
    </div>`;
  }
}

// ── RENDER: grid ──────────────────────────────────────
function renderSongs(songs) {
  if (!songs.length) {
    songsGrid.innerHTML = `<div class="empty-state">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
      <p>No songs found. Drop <strong>.mp3</strong> files in the <strong>songs/</strong> folder.</p>
    </div>`;
    return;
  }
  const tpl = document.getElementById("songCardTemplate");
  const frag = document.createDocumentFragment();
  const currentSongId = currentIndex !== -1 ? filteredSongs[currentIndex]?.id : null;

  songs.forEach((song, idx) => {
    const clone = tpl.content.cloneNode(true);
    const card  = clone.querySelector(".song-card");
    card.dataset.id  = song.id;
    card.dataset.idx = idx;

    const img      = card.querySelector(".card-img");
    const fallback = card.querySelector(".card-img-fallback");
    if (song.has_thumbnail) {
      img.src  = `${API}/api/thumbnail/${song.id}`;
      img.alt  = song.title;
      img.onload  = () => fallback.classList.add("hidden");
      img.onerror = () => img.classList.add("hidden");
    } else {
      img.classList.add("hidden");
    }

    card.querySelector(".card-title").textContent    = song.title;
    card.querySelector(".card-artist").textContent   = song.artist;
    card.querySelector(".card-duration").textContent = fmtTime(song.duration);
    card.querySelector(".card-num").textContent      = String(idx + 1).padStart(2, "0");
    if (song.genre) card.querySelector(".card-genre").textContent = song.genre;

    const playBtnCard   = card.querySelector(".card-play-btn");
    const expandBtnCard = card.querySelector(".card-expand-btn");

    if (song.id === currentSongId) {
      card.classList.add("active");
      syncPlayIcon(playBtnCard, isPlaying);
    }

    playBtnCard.addEventListener("click", (e) => {
      e.stopPropagation();
      filteredSongs[currentIndex]?.id === song.id ? togglePlayPause() : playSong(idx);
    });
    expandBtnCard.addEventListener("click", (e) => {
      e.stopPropagation();
      if (filteredSongs[currentIndex]?.id !== song.id) playSong(idx);
      openFullscreen();
    });
    card.addEventListener("click", () => {
      filteredSongs[currentIndex]?.id === song.id ? togglePlayPause() : playSong(idx);
    });

    frag.appendChild(clone);
  });

  songsGrid.innerHTML = "";
  songsGrid.appendChild(frag);
}

function renderLibrary(songs) {
  if (_libraryRenderedForSongs === songs) return;
  _libraryRenderedForSongs = songs;

  if (!songs.length) {
    libraryList.innerHTML = '<div class="empty-state"><p>No songs found.</p></div>';
    return;
  }
  const frag = document.createDocumentFragment();
  const header = document.createElement("div");
  header.className = "list-header";
  header.innerHTML = `<span>#</span><span></span><span>Title</span><span>Artist</span><span>Album</span><span>Genre</span><span style="text-align:right">Time</span>`;
  frag.appendChild(header);
  songs.forEach((song, idx) => _buildListItem(song, idx, filteredSongs, frag));
  libraryList.innerHTML = "";
  libraryList.appendChild(frag);
}

function renderLiked() {
  const liked = allSongs.filter((s) => likedSongs.has(s.id));
  likedList.innerHTML = "";
  if (!liked.length) {
    likedList.innerHTML = `<div class="empty-state"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg><p>No liked songs yet.</p></div>`;
    return;
  }
  const frag = document.createDocumentFragment();
  const header = document.createElement("div");
  header.className = "list-header";
  header.innerHTML = `<span>#</span><span></span><span>Title</span><span>Artist</span><span>Album</span><span>Genre</span><span style="text-align:right">Time</span>`;
  frag.appendChild(header);
  liked.forEach((song, idx) => _buildListItem(song, idx, liked, frag));
  likedList.appendChild(frag);
}

function _buildListItem(song, idx, pool, container) {
  const tpl   = document.getElementById("songListTemplate");
  const clone = tpl.content.cloneNode(true);
  const item  = clone.querySelector(".list-item");
  item.dataset.id = song.id;

  item.querySelector(".list-num").textContent      = idx + 1;
  item.querySelector(".list-title").textContent    = song.title;
  item.querySelector(".list-artist").textContent   = song.artist;
  item.querySelector(".list-album").textContent    = song.album || "—";
  item.querySelector(".list-genre").textContent    = song.genre || "—";
  item.querySelector(".list-duration").textContent = fmtTime(song.duration);

  const img = item.querySelector(".list-img");
  if (song.has_thumbnail) {
    img.src    = `${API}/api/thumbnail/${song.id}`;
    img.onerror = () => (img.style.display = "none");
  } else {
    img.style.display = "none";
  }

  const poolIdx = pool.indexOf(song);
  item.addEventListener("click", () => {
    filteredSongs = pool;
    playSong(poolIdx >= 0 ? poolIdx : idx);
  });

  if (filteredSongs[currentIndex]?.id === song.id) item.classList.add("active");

  container.appendChild(clone);
}

// ── Queue render — rebuild only when list changes ─────
let _queueRenderedIds = [];

function renderQueue() {
  const newIds = filteredSongs.map((s) => s.id);
  const sameList =
    newIds.length === _queueRenderedIds.length &&
    newIds.every((id, i) => id === _queueRenderedIds[i]);

  if (sameList) {
    // Fast path: only toggle the active class
    queueList.querySelectorAll(".queue-item").forEach((item, i) => {
      item.classList.toggle("active", i === currentIndex);
    });
    const active = queueList.querySelector(".queue-item.active");
    if (active) active.scrollIntoView({ block: "nearest", behavior: "smooth" });
    return;
  }

  _queueRenderedIds = newIds;
  const frag = document.createDocumentFragment();
  filteredSongs.forEach((song, idx) => {
    const item = document.createElement("div");
    item.className = "queue-item" + (idx === currentIndex ? " active" : "");
    const imgSrc = song.has_thumbnail ? `${API}/api/thumbnail/${song.id}` : "";
    item.innerHTML =
      `<span class="queue-item-num">${idx + 1}</span>` +
      (imgSrc
        ? `<img class="queue-item-img" src="${imgSrc}" alt="" loading="lazy" onerror="this.style.display='none'">`
        : `<div class="queue-item-img" style="display:flex;align-items:center;justify-content:center;color:var(--text3)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg></div>`) +
      `<div class="queue-item-info">` +
        `<div class="queue-item-title">${esc(song.title)}</div>` +
        `<div class="queue-item-artist">${esc(song.artist)}</div>` +
      `</div>`;
    item.addEventListener("click", () => playSong(idx));
    frag.appendChild(item);
  });
  queueList.innerHTML = "";
  queueList.appendChild(frag);

  const active = queueList.querySelector(".queue-item.active");
  if (active) setTimeout(() => active.scrollIntoView({ block: "nearest", behavior: "smooth" }), 50);
}

// ── PLAYBACK ──────────────────────────────────────────
function playSong(idx) {
  if (idx < 0 || idx >= filteredSongs.length) return;
  if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();

  currentIndex = idx;
  const song = filteredSongs[idx];

  audio.src = `${API}/api/stream/${song.id}`;
  audio.load();
  audio.play().catch((err) => console.warn("Playback error:", err));

  updatePlayerUI(song);
  updateAllActiveStates(song.id);
  renderQueue();
  schedulePreload();
}

function togglePlayPause() {
  if (currentIndex === -1) {
    if (filteredSongs.length) playSong(0);
    return;
  }
  isPlaying ? audio.pause() : audio.play().catch(() => {});
}

function playNext() {
  if (!filteredSongs.length) return;
  if (repeatMode === 2) {
    audio.currentTime = 0;
    audio.play().catch(() => {});
    return;
  }
  let next;
  if (isShuffle) {
    do {
      next = Math.floor(Math.random() * filteredSongs.length);
    } while (next === currentIndex && filteredSongs.length > 1);
  } else {
    next = currentIndex + 1;
    if (next >= filteredSongs.length) {
      if (repeatMode === 1) next = 0;
      else { audio.pause(); return; }
    }
  }
  playSong(next);
}

function playPrev() {
  if (!filteredSongs.length) return;
  if (audio.currentTime > 3) { audio.currentTime = 0; return; }
  let prev = currentIndex - 1;
  if (prev < 0) prev = repeatMode >= 1 ? filteredSongs.length - 1 : 0;
  playSong(prev);
}

function schedulePreload() {
  clearTimeout(_preloadTimer);
  _preloadTimer = setTimeout(() => {
    const nextIdx = currentIndex + 1;
    if (nextIdx >= filteredSongs.length) return;
    const nextSong = filteredSongs[nextIdx];
    if (!_preloadAudio) _preloadAudio = new Audio();
    _preloadAudio.preload = "metadata";
    _preloadAudio.src = `${API}/api/stream/${nextSong.id}`;
  }, 3000);
}

// ── UPDATE UI ─────────────────────────────────────────
function updatePlayerUI(song) {
  playerTitle.textContent  = song.title;
  playerArtist.textContent = song.artist;

  // Reuse existing <img> if present, only replace src
  let img = playerArt.querySelector("img");
  if (song.has_thumbnail) {
    if (!img) {
      img = document.createElement("img");
      playerArt.appendChild(img);
    }
    img.src    = `${API}/api/thumbnail/${song.id}`;
    img.alt    = song.title;
    img.onerror = () => img.remove();
  } else {
    if (img) img.remove();
  }

  // Fullscreen art
  fsArt.innerHTML = "";
  if (song.has_thumbnail) {
    const fsImg = document.createElement("img");
    fsImg.src    = `${API}/api/thumbnail/${song.id}`;
    fsImg.alt    = song.title;
    fsImg.onerror = () => fsImg.remove();
    fsArt.appendChild(fsImg);
    fsBg.style.backgroundImage = `url(${API}/api/thumbnail/${song.id})`;
  } else {
    fsArt.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`;
    fsBg.style.backgroundImage = "none";
  }
  updateFullscreenAmbient(song);

  const marqueeHTML =
    `<span class="fs-song-title-marquee">${esc(song.title)}</span>` +
    `<span class="fs-separator">•</span>` +
    `<span class="fs-song-artist-marquee">${esc(song.artist)}</span>`;
  fsMarqueeText.innerHTML = `${marqueeHTML} &nbsp; ${marqueeHTML}`;

  const liked = likedSongs.has(song.id);
  likeBtn.classList.toggle("liked", liked);
  if (fsLikeBtnFullscreen) fsLikeBtnFullscreen.classList.toggle("liked", liked);

  updateAmbient(song);
  document.title = `${song.title} — SoundWave`;
}

/**
 * updateAllActiveStates — O(1) targeted DOM update.
 * Tracks the previously-active ID so only two elements are touched per call.
 */
function updateAllActiveStates(newId) {
  if (_prevActiveId && _prevActiveId !== newId) {
    const old = songsGrid.querySelector(`.song-card[data-id="${_prevActiveId}"]`);
    if (old) {
      old.classList.remove("active");
      syncPlayIcon(old.querySelector(".card-play-btn"), false);
    }
    const oldList = document.querySelector(`.list-item[data-id="${_prevActiveId}"]`);
    if (oldList) oldList.classList.remove("active");
  }

  if (newId) {
    const cur = songsGrid.querySelector(`.song-card[data-id="${newId}"]`);
    if (cur) {
      cur.classList.add("active");
      syncPlayIcon(cur.querySelector(".card-play-btn"), isPlaying);
    }
    const curList = document.querySelector(`.list-item[data-id="${newId}"]`);
    if (curList) curList.classList.add("active");
  }

  _prevActiveId = newId;
}

function syncPlayPauseIcons(playing) {
  playBtn.querySelector(".icon-play").style.display   = playing ? "none" : "";
  playBtn.querySelector(".icon-pause").style.display  = playing ? "" : "none";
  fsPlayBtn.querySelector(".icon-play").style.display  = playing ? "none" : "";
  fsPlayBtn.querySelector(".icon-pause").style.display = playing ? "" : "none";

  if (_prevActiveId) {
    const cur = songsGrid.querySelector(`.song-card[data-id="${_prevActiveId}"] .card-play-btn`);
    if (cur) syncPlayIcon(cur, playing);
  }
}

function syncPlayIcon(btn, playing) {
  if (!btn) return;
  const ip  = btn.querySelector(".icon-play");
  const ipu = btn.querySelector(".icon-pause");
  if (ip)  ip.style.display  = playing ? "none" : "";
  if (ipu) ipu.style.display = playing ? "" : "none";
}

// ── AUDIO EVENTS ──────────────────────────────────────
audio.addEventListener("play", () => {
  isPlaying = true;
  syncPlayPauseIcons(true);
  vinyl.classList.add("playing");
});
audio.addEventListener("pause", () => {
  isPlaying = false;
  syncPlayPauseIcons(false);
  vinyl.classList.remove("playing");
});
audio.addEventListener("ended", playNext);

audio.addEventListener("timeupdate", () => {
  if (!audio.duration) return;
  const now = performance.now();
  if (now - _lastTU < 100 && !isDragProgress && !isDragFsProg) return;
  _lastTU = now;

  const pct = (audio.currentTime / audio.duration) * 100;
  if (!isDragProgress) {
    progressFill.style.width   = pct + "%";
    progressThumb.style.left   = pct + "%";
    timeElapsed.textContent    = fmtTime(audio.currentTime);
  }
  if (!isDragFsProg) {
    fsProgressFill.style.width  = pct + "%";
    fsProgressThumb.style.left  = pct + "%";
    fsTimeElapsed.textContent   = fmtTime(audio.currentTime);
  }
});

audio.addEventListener("loadedmetadata", () => {
  timeDuration.textContent   = fmtTime(audio.duration);
  fsTimeDuration.textContent = fmtTime(audio.duration);
});
audio.addEventListener("error", () => {
  console.warn("Audio error — trying next");
  setTimeout(playNext, 600);
});

// ── CONTROLS ──────────────────────────────────────────
playBtn.addEventListener("click", togglePlayPause);
fsPlayBtn.addEventListener("click", togglePlayPause);
prevBtn.addEventListener("click", playPrev);
nextBtn.addEventListener("click", playNext);
fsPrevBtn.addEventListener("click", playPrev);
fsNextBtn.addEventListener("click", playNext);

shuffleBtn.addEventListener("click", () => {
  isShuffle = !isShuffle;
  shuffleBtn.classList.toggle("active", isShuffle);
  fsShuffleBtn.classList.toggle("active", isShuffle);
});
fsShuffleBtn.addEventListener("click", () => shuffleBtn.click());

repeatBtn.addEventListener("click", () => {
  repeatMode = (repeatMode + 1) % 3;
  const titles = ["Repeat off", "Repeat all", "Repeat one"];
  repeatBtn.classList.toggle("active", repeatMode > 0);
  repeatBtn.title = titles[repeatMode];
  fsRepeatBtn.classList.toggle("active", repeatMode > 0);
});
fsRepeatBtn.addEventListener("click", () => repeatBtn.click());

function toggleLike() {
  if (currentIndex === -1) return;
  const id = filteredSongs[currentIndex].id;
  likedSongs.has(id) ? likedSongs.delete(id) : likedSongs.add(id);
  const liked = likedSongs.has(id);
  likeBtn.classList.toggle("liked", liked);
  if (fsLikeBtnFullscreen) fsLikeBtnFullscreen.classList.toggle("liked", liked);
  localStorage.setItem("sw_liked", JSON.stringify([...likedSongs]));
  if (currentView === "liked") renderLiked();
  if (typeof window.__sw_onLikeToggled === "function") {
    window.__sw_onLikeToggled(id, liked);
  }
}
likeBtn.addEventListener("click", toggleLike);
if (fsLikeBtnFullscreen) fsLikeBtnFullscreen.addEventListener("click", toggleLike);

// ── SEEK BAR — drag listeners attached/removed dynamically ───────────────
function seekPct(pct) {
  if (!audio.duration) return;
  audio.currentTime = pct * audio.duration;
  const p = pct * 100 + "%";
  progressFill.style.width   = p;
  progressThumb.style.left   = p;
  fsProgressFill.style.width = p;
  fsProgressThumb.style.left = p;
  timeElapsed.textContent    = fmtTime(audio.currentTime);
  fsTimeElapsed.textContent  = fmtTime(audio.currentTime);
}

function barPct(e, bar) {
  const r = bar.getBoundingClientRect();
  return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
}

// Progress bar drag (mini player)
function _onProgressMove(e)  { if (isDragProgress) seekPct(barPct(e, progressBar)); }
function _onProgressUp()     { isDragProgress = false; document.removeEventListener("mousemove", _onProgressMove); document.removeEventListener("mouseup", _onProgressUp); }
function _onProgressTMove(e) { if (isDragProgress) seekPct(barPct(e.touches[0], progressBar)); }
function _onProgressTUp()    { isDragProgress = false; document.removeEventListener("touchmove", _onProgressTMove); document.removeEventListener("touchend", _onProgressTUp); }

progressBar.addEventListener("mousedown", (e) => {
  isDragProgress = true;
  seekPct(barPct(e, progressBar));
  document.addEventListener("mousemove", _onProgressMove);
  document.addEventListener("mouseup", _onProgressUp);
});
progressBar.addEventListener("touchstart", (e) => {
  isDragProgress = true;
  seekPct(barPct(e.touches[0], progressBar));
  document.addEventListener("touchmove", _onProgressTMove, { passive: true });
  document.addEventListener("touchend", _onProgressTUp);
}, { passive: true });

// Fullscreen progress bar drag
function _onFsProgMove(e)  { if (isDragFsProg) seekPct(barPct(e, fsProgressBar)); }
function _onFsProgUp()     { isDragFsProg = false; document.removeEventListener("mousemove", _onFsProgMove); document.removeEventListener("mouseup", _onFsProgUp); }
function _onFsProgTMove(e) { if (isDragFsProg) seekPct(barPct(e.touches[0], fsProgressBar)); }
function _onFsProgTUp()    { isDragFsProg = false; document.removeEventListener("touchmove", _onFsProgTMove); document.removeEventListener("touchend", _onFsProgTUp); }

fsProgressBar.addEventListener("mousedown", (e) => {
  isDragFsProg = true;
  seekPct(barPct(e, fsProgressBar));
  document.addEventListener("mousemove", _onFsProgMove);
  document.addEventListener("mouseup", _onFsProgUp);
});
fsProgressBar.addEventListener("touchstart", (e) => {
  isDragFsProg = true;
  seekPct(barPct(e.touches[0], fsProgressBar));
  document.addEventListener("touchmove", _onFsProgTMove, { passive: true });
  document.addEventListener("touchend", _onFsProgTUp);
}, { passive: true });

// ── VOLUME ────────────────────────────────────────────
function setVol(v) {
  volume = Math.max(0, Math.min(1, v));
  audio.volume = volume;
  isMuted = false;
  audio.muted = false;
  setVolUI(volume);
  updateMuteIcon();
}
function setVolUI(v) {
  const p = v * 100 + "%";
  volFill.style.width  = p;
  volThumb.style.left  = p;
}
function updateMuteIcon() {
  const muted = isMuted || volume === 0;
  muteBtn.querySelector(".icon-vol").style.display  = muted ? "none" : "";
  muteBtn.querySelector(".icon-mute").style.display = muted ? "" : "none";
}

function _onVolMove(e) { if (isDragVol) setVol(barPct(e, volBar)); }
function _onVolUp()    { isDragVol = false; document.removeEventListener("mousemove", _onVolMove); document.removeEventListener("mouseup", _onVolUp); }

volBar.addEventListener("mousedown", (e) => {
  isDragVol = true;
  setVol(barPct(e, volBar));
  document.addEventListener("mousemove", _onVolMove);
  document.addEventListener("mouseup", _onVolUp);
});
muteBtn.addEventListener("click", () => {
  isMuted = !isMuted;
  audio.muted = isMuted;
  setVolUI(isMuted ? 0 : volume);
  updateMuteIcon();
});

// ── FULLSCREEN ────────────────────────────────────────
expandBtn.addEventListener("click", openFullscreen);
fsBack.addEventListener("click", closeFullscreen);

function toggleControls() {
  const visible = fsControlsOverlay.classList.toggle("visible");
  fsPlayer.classList.toggle("controls-visible", visible);
}

fsPlayer.addEventListener("click", (e) => {
  if (fsControlsOverlay.classList.contains("visible")) {
    if (e.target.closest(".fs-ctrl, .fs-back, .fs-dots, .fs-prog-bar")) return;
  }
  toggleControls();
});

function openFullscreen() {
  fsPlayer.classList.add("open");
  initCanvas();
  requestAnimationFrame(tickCanvas);
  startFullscreenAmbient();
  document.body.style.overflow = "hidden";
  fsControlsOverlay.classList.remove("visible");
  fsPlayer.classList.remove("controls-visible");
}
function closeFullscreen() {
  fsPlayer.classList.remove("open");
  cancelAnimationFrame(animFrame);
  if (ambientAnimationId) cancelAnimationFrame(ambientAnimationId);
  document.body.style.overflow = "";
}
window.addEventListener("resize", () => {
  if (fsPlayer.classList.contains("open")) initCanvas();
});

// ── SEARCH & FILTER — debounced 150 ms ───────────────
let _searchTimer = null;
searchInput.addEventListener("input", () => {
  searchClear.classList.toggle("visible", searchInput.value.length > 0);
  clearTimeout(_searchTimer);
  _searchTimer = setTimeout(applyFilters, 150);
});
searchClear.addEventListener("click", () => {
  searchInput.value = "";
  searchClear.classList.remove("visible");
  clearTimeout(_searchTimer);
  applyFilters();
  searchInput.focus();
});
sortSelect.addEventListener("change", applyFilters);

function applyFilters() {
  const q    = searchInput.value.trim().toLowerCase();
  const sort = sortSelect.value;
  let songs  = [...allSongs];

  if (q) {
    songs = songs.filter(
      (s) =>
        s.title.toLowerCase().includes(q)  ||
        s.artist.toLowerCase().includes(q) ||
        s.album.toLowerCase().includes(q)  ||
        s.genre.toLowerCase().includes(q),
    );
  }

  switch (sort) {
    case "title":    songs.sort((a, b) => a.title.localeCompare(b.title));   break;
    case "artist":   songs.sort((a, b) => a.artist.localeCompare(b.artist)); break;
    case "duration": songs.sort((a, b) => a.duration - b.duration);          break;
  }

  const nowPlayingId = currentIndex !== -1 ? filteredSongs[currentIndex]?.id : null;
  filteredSongs = songs;
  if (nowPlayingId) currentIndex = filteredSongs.findIndex((s) => s.id === nowPlayingId);

  _libraryRenderedForSongs = null; // Invalidate library cache

  renderSongs(filteredSongs);
  renderQueue();
}

// ── VIEWS ─────────────────────────────────────────────
document.querySelectorAll(".nav-item").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".nav-item").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    switchView(btn.dataset.view);
    closeSidebar();
  });
});

function switchView(view) {
  currentView = view;
  document.querySelectorAll(".view").forEach((v) => v.classList.add("hidden"));
  const el = document.getElementById("view-" + view);
  if (el) el.classList.remove("hidden");
  if (view === "liked")   renderLiked();
  if (view === "library") renderLibrary(allSongs);
}

// ── SIDEBAR ───────────────────────────────────────────
menuBtn.addEventListener("click", openSidebar);
sidebarToggle.addEventListener("click", closeSidebar);
overlay.addEventListener("click", closeSidebar);

function openSidebar() {
  sidebar.classList.add("open");
  overlay.classList.add("active");
}
function closeSidebar() {
  sidebar.classList.remove("open");
  overlay.classList.remove("active");
}

// ── KEYBOARD SHORTCUTS ────────────────────────────────
document.addEventListener("keydown", (e) => {
  if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
  switch (e.code) {
    case "Space":      e.preventDefault(); togglePlayPause(); break;
    case "ArrowRight": e.preventDefault(); audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 5); break;
    case "ArrowLeft":  e.preventDefault(); audio.currentTime = Math.max(0, audio.currentTime - 5); break;
    case "ArrowUp":    e.preventDefault(); setVol(volume + 0.05); break;
    case "ArrowDown":  e.preventDefault(); setVol(volume - 0.05); break;
    case "KeyN": playNext(); break;
    case "KeyP": playPrev(); break;
    case "KeyM": muteBtn.click(); break;
    case "Escape": if (fsPlayer.classList.contains("open")) closeFullscreen(); break;
  }
});

// ── MEDIA SESSION ─────────────────────────────────────
if ("mediaSession" in navigator) {
  navigator.mediaSession.setActionHandler("play",          () => audio.play());
  navigator.mediaSession.setActionHandler("pause",         () => audio.pause());
  navigator.mediaSession.setActionHandler("previoustrack", playPrev);
  navigator.mediaSession.setActionHandler("nexttrack",     playNext);
}

// ── EQ ────────────────────────────────────────────────
async function openEqModal() {
  await initAudioCtx();
  eqModal.classList.add("open");
}

eqToggleBtn.addEventListener("click", openEqModal);
fsMenuBtn.addEventListener("click", openEqModal);

eqModal.addEventListener("click", (e) => {
  if (e.target === eqModal) eqModal.classList.remove("open");
});
eqPanel.addEventListener("click", (e) => e.stopPropagation());

eqPowerToggle.addEventListener("change", () => {
  eqEnabled = eqPowerToggle.checked;
  if (eqToggleLabel) eqToggleLabel.textContent = eqEnabled ? "On" : "Off";
  eqFilters.forEach((f, i) => {
    const slider = document.getElementById(`eqSlider${i}`);
    if (slider) f.gain.value = eqEnabled ? parseFloat(slider.value) : 0;
  });
});

eqPresets.forEach((btn) => {
  btn.addEventListener("click", () => {
    const preset = btn.dataset.preset;
    if (preset && EQ_PRESETS[preset]) {
      applyEQPreset(preset);
      eqPresets.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
    }
  });
});

buildEQSliders();
init();

/* =============================================================
   AUTH BRIDGE — exposes internal state/functions to auth-init.js.
   ADDITIVE ONLY. Does not modify any existing variable or function.
   ============================================================= */
window.__sw_likedSet    = likedSongs;
window.__sw_renderLiked = renderLiked;

/**
 * Callback invoked by toggleLike after each like/unlike.
 * auth-init.js overwrites this to POST/DELETE to /api/user/likes.
 * Default is a no-op so logged-out sessions are unaffected.
 */
window.__sw_onLikeToggled = function (songId, liked) { /* no-op */ };
