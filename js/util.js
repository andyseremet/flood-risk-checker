// Small shared helpers: DOM lookup, escaping, fetch with timeout, distances, dates.
(function (root) {
  "use strict";
  const FRC = (root.FRC = root.FRC || {});

  const util = {
    $: (id) => document.getElementById(id),

    esc: (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])),

    async getJSON(url, timeoutMs = 15000) {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const r = await fetch(url, { signal: ctrl.signal, headers: { Accept: "application/json" } });
        if (!r.ok) throw new Error("HTTP " + r.status);
        return await r.json();
      } catch (e) {
        if (e.name === "AbortError") throw new Error("timed out after " + timeoutMs / 1000 + " s");
        throw e;
      } finally {
        clearTimeout(t);
      }
    },

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
