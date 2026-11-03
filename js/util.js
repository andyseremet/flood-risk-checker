// Small shared helpers: DOM lookup, escaping, fetch with timeout, distances, dates.
(function (root) {
  "use strict";
  const FRC = (root.FRC = root.FRC || {});

  const pause = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---------- Shared request limit ----------
  const MAX_PARALLEL = 4;
  const net = { running: 0, queue: [], fresh: 0, stats: { cached: 0, retried: 0 } };
  function limited(fn) {
    return new Promise((resolve, reject) => {
      const run = () => {
        net.running++;
        Promise.resolve().then(fn).then(resolve, reject).finally(() => { net.running--; const next = net.queue.shift(); if (next) next(); });
      };
      if (net.running < MAX_PARALLEL) run(); else net.queue.push(run);
    });
  }

  // ---------- Remembered results (about an hour) ----------
  // Kept in memory, and in this browser's storage when small enough, so a
  // reload within the hour still reuses them. Nothing leaves the browser.
  const CACHE_MINUTES = 60, PREFIX = "frc-cache:", MAX_STORED = 300 * 1024;
  const store = (() => { try { return root.localStorage || null; } catch { return null; } })();
  const mem = new Map();
  const cache = {
    get(url) {
      const now = Date.now();
      let e = mem.get(url);
      if (!e && store) { try { const raw = store.getItem(PREFIX + url); if (raw) { e = JSON.parse(raw); mem.set(url, e); } } catch { /* ignore */ } }
      if (!e) return undefined;
      if (now - e.at > CACHE_MINUTES * 60000) { mem.delete(url); try { store && store.removeItem(PREFIX + url); } catch { /* ignore */ } return undefined; }
      return JSON.parse(e.json);
    },
    set(url, data) {
      const e = { at: Date.now(), json: JSON.stringify(data) };
      mem.set(url, e);
      if (!store || e.json.length > MAX_STORED) return;
      try { store.setItem(PREFIX + url, JSON.stringify(e)); }
      catch { cache.prune(true); try { store.setItem(PREFIX + url, JSON.stringify(e)); } catch { /* storage full: memory only */ } }
    },
    // Remove expired entries (or all stored entries when storage is full).
    prune(all = false) {
      if (!store) return;
      try {
        for (let i = store.length - 1; i >= 0; i--) {
          const k = store.key(i);
          if (!k || !k.startsWith(PREFIX)) continue;
          let old = all;
          if (!old) { try { old = Date.now() - JSON.parse(store.getItem(k)).at > CACHE_MINUTES * 60000; } catch { old = true; } }
          if (old) store.removeItem(k);
        }
      } catch { /* ignore */ }
    },
    clear() { mem.clear(); cache.prune(true); },
    size() { let n = mem.size; return n; },
  };
  cache.prune();

  const util = {
    $: (id) => document.getElementById(id),

    esc: (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])),

    // Fetch JSON with a time limit. Three things cut errors here:
    // - a slow, dropped or overloaded request is tried again by itself, up to
    //   twice, after a short wait (not for a refusal such as 404);
    // - at most MAX_PARALLEL requests run at once, which helps phones and slow links;
    // - map data (not live warnings or gauges) is remembered for CACHE_MINUTES,
    //   so checking the same place again does not fetch it all again.
    // A failure carries .url, so the error log can link to the exact request.
    async getJSON(url, timeoutMs = 15000, { retries = 2 } = {}) {
      const cacheable = !/flood-monitoring/.test(url);
      if (cacheable && !net.fresh) { const hit = cache.get(url); if (hit !== undefined) { net.stats.cached++; return hit; } }
      let lastError = null, attempts = 0, timeouts = 0;
      for (let attempt = 0; attempt <= retries; attempt++) {
        if (attempt) { net.stats.retried++; await pause(attempt === 1 ? 1500 : 4000); }
        attempts++;
        try {
          const data = await limited(async () => {
            const ctrl = new AbortController();
            const t = setTimeout(() => ctrl.abort(), timeoutMs);
            try {
              const r = await fetch(url, { signal: ctrl.signal, headers: { Accept: "application/json" } });
              if (!r.ok) { const e = new Error("HTTP " + r.status); e.status = r.status; throw e; }
              return await r.json();
            } catch (e) {
              if (e.name === "AbortError") { const t2 = new Error("timed out after " + timeoutMs / 1000 + " s"); t2.timeout = true; throw t2; }
              throw e;
            } finally { clearTimeout(t); }
          });
          // An ArcGIS error comes back as HTTP 200 with an "error" body: never keep it.
          if (cacheable && !(data && data.error)) cache.set(url, data);
          return data;
        } catch (e) {
          lastError = e;
          // A refusal (other than "too many requests") will not change on a retry.
          if (e.status && e.status < 500 && e.status !== 429) break;
          // A slow service gets one more try, not two, so a site check is not held up.
          if (e.timeout && ++timeouts >= 2) break;
        }
      }
      lastError.url = url;
      lastError.attempts = attempts;
      if (attempts > 1) lastError.message += ` (tried ${attempts} times)`;
      throw lastError;
    },

    // Run fn() inside the shared request limit (for fetches made without getJSON).
    limited: (fn) => limited(fn),

    // Run fn() without using remembered results (connection tests, Check again).
    async fresh(fn) {
      net.fresh++;
      try { return await fn(); } finally { net.fresh--; }
    },

    cache: { clear: () => cache.clear(), size: () => cache.size() },
    net: () => ({ ...net.stats, running: net.running, waiting: net.queue.length }),

    // Great-circle distance in km (used only for "how far is the gauge").
    km(aLat, aLon, bLat, bLon) {
      const R = 6371, toR = Math.PI / 180;
      const dLat = (bLat - aLat) * toR, dLon = (bLon - aLon) * toR;
      const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * toR) * Math.cos(bLat * toR) * Math.sin(dLon / 2) ** 2;
      return 2 * R * Math.asin(Math.sqrt(h));
    },

    fmtDate(s) {
      try { return new Date(s).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }); } catch { return String(s); }
    },

    fmtNum(n, dp = 0) {
      return Number(n).toLocaleString("en-GB", { minimumFractionDigits: dp, maximumFractionDigits: dp });
    },

    // Point-in-polygon on GeoJSON Polygon / MultiPolygon (holes respected).
    inRing(x, y, ring) {
      let inside = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i], [xj, yj] = ring[j];
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
      }
      return inside;
    },
    inGeometry(lon, lat, g) {
      if (!g) return false;
      const polys = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
      return polys.some((p) => util.inRing(lon, lat, p[0]) && !p.slice(1).some((h) => util.inRing(lon, lat, h)));
    },
  };

  FRC.util = util;
  if (typeof module !== "undefined" && module.exports) module.exports = util;
})(typeof window !== "undefined" ? window : globalThis);
