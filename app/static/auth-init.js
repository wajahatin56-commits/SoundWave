"use strict";
/* =======================================================================
   auth-init.js — Authentication UI layer for SoundWave

   INTEGRATION CONTRACT WITH app.js:
     window.__sw_likedSet       — live reference to the `likedSongs` Set
     window.__sw_renderLiked    — function to re-render the Liked Songs view
     window.__sw_onLikeToggled  — callback(songId, isNowLiked) — no-op by default
   =======================================================================*/

(function () {
  const authArea      = document.getElementById("authArea");
  const authLoggedIn  = document.getElementById("authLoggedIn");
  const authLoggedOut = document.getElementById("authLoggedOut");
  const userAvatar    = document.getElementById("userAvatar");
  const userName      = document.getElementById("userName");
  const logoutBtn     = document.getElementById("logoutBtn");

  if (!authArea) return;

  // ── UI helpers ──────────────────────────────────────────────────────────

  function showLoggedIn(user) {
    userAvatar.textContent = (user.username || "?")[0].toUpperCase();
    userName.textContent   = user.username;
    authLoggedIn.style.display  = "flex";
    authLoggedOut.style.display = "none";
    authArea.style.display      = "flex";
  }

  function showLoggedOut() {
    authLoggedIn.style.display  = "none";
    authLoggedOut.style.display = "block";
    authArea.style.display      = "flex";
  }

  // ── Main auth check ─────────────────────────────────────────────────────

  async function checkAuthState() {
    try {
      const res = await fetch("/auth/me", { credentials: "same-origin" });
      if (!res.ok) { showLoggedOut(); return; }
      const data = await res.json();
      if (data.user) {
        showLoggedIn(data.user);
        await waitForBridge();
        await loadServerLikes();
        wireLikeSync();
      } else {
        showLoggedOut();
      }
    } catch (err) {
      console.warn("[auth-init] /auth/me failed:", err);
      authArea.style.display = "none";
    }
  }

  // ── Bridge wait — poll until app.js exposes its shared state ───────────

  function waitForBridge(attempts) {
    attempts = attempts || 0;
    return new Promise(function (resolve) {
      if (window.__sw_likedSet) { resolve(); return; }
      if (attempts > 60) {
        console.warn("[auth-init] Bridge not available after 3s — skipping like sync");
        resolve();
        return;
      }
      setTimeout(function () {
        waitForBridge(attempts + 1).then(resolve);
      }, 50);
    });
  }

  // ── Load server likes and merge into app.js state ──────────────────────

  async function loadServerLikes() {
    try {
      const res = await fetch("/api/user/likes", { credentials: "same-origin" });
      if (!res.ok) return;

      const data = await res.json();
      const serverIds = data.liked || [];

      const liveSet = window.__sw_likedSet;
      if (liveSet && serverIds.length) {
        serverIds.forEach(function (id) { liveSet.add(id); });

        const localArr = JSON.parse(localStorage.getItem("sw_liked") || "[]");
        const merged   = Array.from(new Set(localArr.concat(serverIds)));
        localStorage.setItem("sw_liked", JSON.stringify(merged));
      }

      if (typeof window.__sw_renderLiked === "function") {
        window.__sw_renderLiked();
      }

      _syncPlayerLikeButton();
    } catch (err) {
      console.warn("[auth-init] Could not load server likes:", err);
    }
  }

  // ── Update the player bar like button state after merge ─────────────────

  function _syncPlayerLikeButton() {
    try {
      const likeBtn   = document.getElementById("likeBtn");
      const fsLikeBtn = document.getElementById("fsLikeBtnFullscreen");
      const liveSet   = window.__sw_likedSet;
      if (!liveSet) return;

      const activeCard = document.querySelector(".song-card.active");
      if (!activeCard) return;
      const songId = activeCard.dataset.id;
      if (!songId) return;

      const liked = liveSet.has(songId);
      if (likeBtn) {
        likeBtn.classList.toggle("liked", liked);
        const svg = likeBtn.querySelector("svg");
        if (svg) svg.style.fill = liked ? "#f43f5e" : "";
      }
      if (fsLikeBtn) {
        fsLikeBtn.classList.toggle("liked", liked);
        const svg = fsLikeBtn.querySelector("svg");
        if (svg) svg.style.fill = liked ? "#f43f5e" : "";
      }
    } catch (_) { /* non-fatal */ }
  }

  // ── Wire like/unlike → server sync ─────────────────────────────────────

  function wireLikeSync() {
    window.__sw_onLikeToggled = async function (songId, isNowLiked) {
      try {
        if (isNowLiked) {
          await fetch("/api/user/likes", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ song_id: songId }),
            credentials: "same-origin",
          });
        } else {
          await fetch("/api/user/likes/" + encodeURIComponent(songId), {
            method: "DELETE",
            credentials: "same-origin",
          });
        }
      } catch (err) {
        console.warn("[auth-init] Like sync failed:", err);
      }
    };
  }

  // ── Logout ──────────────────────────────────────────────────────────────

  if (logoutBtn) {
    logoutBtn.addEventListener("click", async function () {
      logoutBtn.disabled = true;
      try {
        const liveSet = window.__sw_likedSet;
        if (liveSet && liveSet.size > 0) {
          await fetch("/api/user/likes/sync", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ song_ids: Array.from(liveSet) }),
            credentials: "same-origin",
          }).catch(function () { /* non-fatal */ });
        }
        await fetch("/auth/logout", { method: "POST", credentials: "same-origin" });
      } catch (_) { /* proceed regardless */ }

      localStorage.removeItem("sw_liked");
      window.location.href = "/login";
    });
  }

  checkAuthState();
})();
