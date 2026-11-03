// Creates the Leaflet map with an OpenStreetMap basemap, and the location marker.
(function (root) {
  "use strict";
  const FRC = (root.FRC = root.FRC || {});

  let map = null, marker = null, gaugeLayer = null, analysisLayer = null;
  let snapQueue = Promise.resolve();
  let snapping = false, lastCentre = null;
  // Remembers the middle of the map after each move, so a resize can put it back.
  const keepCentre = () => { if (!snapping && lastCentre) map.setView(lastCentre, map.getZoom(), { animate: false }); };
  const takeSnapshot = (opts) => FRC.map._snapshot(opts);
  // Approximate width of the map image on the ground, for the caption.
  function scaleText() {
    const b = map.getBounds(), w = map.distance(b.getSouthWest(), L.latLng(b.getSouth(), b.getEast()));
    return w >= 2000 ? `${(w / 1000).toFixed(1)} km across` : `${Math.round(w / 10) * 10} m across`;
  }

  // Resolves when every tile layer on the map has finished loading, or after
  // the timeout so a slow or blocked service cannot stall the report.
  function waitForTiles(m, timeout) {
    const pause = (ms) => new Promise((r) => setTimeout(r, ms));
    const loaded = pause(250).then(() => {
      const pending = [];
      m.eachLayer((l) => { if (l instanceof L.GridLayer && l.isLoading && l.isLoading()) pending.push(new Promise((r) => l.once("load", r))); });
      return Promise.all(pending);
    }).then(() => pause(150));
    return Promise.race([loaded, pause(timeout)]);
  }

  const loadImage = (src) => new Promise((resolve) => {
    const im = new Image();
    im.crossOrigin = "anonymous";
    im.onload = () => resolve(im); im.onerror = () => resolve(null);
    im.src = src;
  });

  // Draws the map into a canvas from what the browser has actually laid out:
  // each tile, overlay, outline and marker is drawn at its on-screen position
  // inside the map. So the image matches the map exactly, and the view set
  // for the snapshot (centred on the pin or the site) is the image's centre.
  async function compose(el, width, height) {
    const box = el.getBoundingClientRect();
    const canvas = document.createElement("canvas");
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#f2efe9"; ctx.fillRect(0, 0, width, height);
    const opacity = (n) => { let o = 1; for (let x = n; x && x !== el; x = x.parentElement) o *= Number(getComputedStyle(x).opacity); return o; };
    const zIndex = (n) => { const p = n.closest(".leaflet-pane"); return p ? Number(getComputedStyle(p).zIndex) || 0 : 0; };
    const nodes = [...el.querySelectorAll(".leaflet-map-pane img, .leaflet-map-pane svg, .leaflet-map-pane canvas")]
      .filter((n) => !(n.tagName === "svg" && n.parentElement.closest("svg")))
      .map((n, i) => ({ n, i, z: zIndex(n) }))
      .sort((a, b) => a.z - b.z || a.i - b.i);
    for (const { n } of nodes) {
      const r = n.getBoundingClientRect();
      if (!r.width || !r.height || r.right < box.left || r.left > box.right || r.bottom < box.top || r.top > box.bottom) continue;
      const o = opacity(n);
      if (!o || getComputedStyle(n).visibility === "hidden" || getComputedStyle(n).display === "none") continue;
      let src = null;
      if (n.tagName === "IMG") src = await loadImage(n.currentSrc || n.src);
      else if (n.tagName === "svg") {
        const copy = n.cloneNode(true);
        copy.setAttribute("xmlns", "http://www.w3.org/2000/svg");
        copy.removeAttribute("style");
        const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(copy)], { type: "image/svg+xml" }));
        src = await loadImage(url); URL.revokeObjectURL(url);
      } else src = n;
      if (!src) continue;
      ctx.globalAlpha = o;
      try { ctx.drawImage(src, r.left - box.left, r.top - box.top, r.width, r.height); } catch { /* a part that cannot be drawn is left out */ }
    }
    ctx.globalAlpha = 1;
    return canvas;
  }

  FRC.map = {
    init(elementId) {
      map = L.map(elementId, { zoomControl: false }).setView([54.3, -2.5], 6);
      L.control.zoom({ position: "bottomleft" }).addTo(map);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19, crossOrigin: true, attribution: "© OpenStreetMap contributors",
      }).addTo(map);
      gaugeLayer = L.layerGroup().addTo(map);
      map.on("moveend", () => { if (!snapping) lastCentre = map.getCenter(); });
      L.control.scale({ imperial: false }).addTo(map);
      // When the map's box changes size (a phone turned round, the page
      // layout changing), keep the same place in the middle of the map.
      if (root.ResizeObserver) new ResizeObserver(() => { map.invalidateSize({ pan: false, debounceMoveend: true }); keepCentre(); }).observe(map.getContainer());
      return map;
    },

    // Put the checked point in the middle of the map.
    centre() { if (marker) map.setView(marker.getLatLng(), map.getZoom()); },
    get() { return map; },

    // Show the checked location. (The 600 m site area around a dropped pin
    // is drawn as a site parcel, so no separate radius circle is shown.)
    showPoint(lat, lon, distKm, { fit = true } = {}) {
      if (marker) marker.remove();
      gaugeLayer.clearLayers();
      marker = L.marker([lat, lon], { title: "Checked location", interactive: false }).addTo(map);
      if (fit) map.setView([lat, lon], distKm >= 5 ? 12 : 14);
    },

    // Draw the flood-zone parts of the site, darkest for the most severe class.
    showAnalysis(analysis) {
      if (!analysisLayer) analysisLayer = L.layerGroup().addTo(map);
      analysisLayer.clearLayers();
      if (!analysis) return;
      const fill = { 1: "#1f4e99", 2: "#5b8fd6", 3: "#a9c6ee" };
      // Only the flood-zone datasets are shaded; reservoir and recorded
      // outlines would hide them. Those are available as map layers instead.
      analysis.datasets.filter((d) => d.primary).forEach((d) => (d.groups || []).forEach((g) => g.rows.forEach((r) => {
        if (!r.geometry) return;
        L.geoJSON(r.geometry, { interactive: true, style: { color: fill[r.rank] || "#5b8fd6", weight: 1, fillColor: fill[r.rank] || "#5b8fd6", fillOpacity: 0.55 } })
          .bindTooltip(`${g.group}: ${r.label}, ${FRC.util.fmtNum(r.area, 0)} m² (${r.percent.toFixed(1)}%)`, { sticky: true })
          .addTo(analysisLayer);
      })));
    },

    // Capture the map as an image for the PDF, centred on the given view, with a given view and overlays,
    // then put the view and layers back as they were.
    // view: { bounds } or { center: [lat, lon], zoom }. overlays: keys of
    // FRC.mapLayers.layers to show (others hidden). analysis: show shading.
    // Snapshots take turns: each one changes the map's size and layers and
    // puts them back, so two at once would restore each other's temporary state.
    snapshot(opts) {
      const run = snapQueue.then(() => takeSnapshot(opts));
      snapQueue = run.catch(() => {});
      return run;
    },

    // minZoom: zoom in at least this far (some layers only draw when close in).
    async _snapshot({ view, overlays = [], analysis = false, width = 900, height = 600, minZoom = 0 }) {
      const el = map.getContainer();
      snapping = true;
      const layers = (FRC.mapLayers && FRC.mapLayers.layers) || {};
      const wasOn = Object.fromEntries(Object.entries(layers).map(([k, l]) => [k, map.hasLayer(l)]));
      const before = { center: map.getCenter(), zoom: map.getZoom() };
      const hadAnalysis = analysisLayer && map.hasLayer(analysisLayer);
      const style = { width: el.style.width, height: el.style.height, position: el.style.position };
      // A fixed size gives every report the same map proportions.
      el.style.width = width + "px"; el.style.height = height + "px";
      map.invalidateSize(false);
      try {
        Object.entries(layers).forEach(([k, l]) => { const want = overlays.includes(k); if (want && !map.hasLayer(l)) l.addTo(map); if (!want && map.hasLayer(l)) map.removeLayer(l); });
        if (analysisLayer) { if (analysis && !hadAnalysis) analysisLayer.addTo(map); if (!analysis && hadAnalysis) map.removeLayer(analysisLayer); }
        if (view.bounds) map.fitBounds(view.bounds, { padding: [30, 30], maxZoom: 18, animate: false });
        else map.setView(view.center, view.zoom, { animate: false });
        if (map.getZoom() < minZoom) map.setZoom(minZoom, { animate: false });
        await waitForTiles(map, 8000);
        const canvas = await compose(el, width, height);
        return { img: canvas.toDataURL("image/jpeg", 0.85), w: canvas.width, h: canvas.height, zoom: map.getZoom(), scale: scaleText() };
      } finally {
        Object.assign(el.style, style);
        map.invalidateSize(false);
        Object.entries(layers).forEach(([k, l]) => { if (wasOn[k] && !map.hasLayer(l)) l.addTo(map); if (!wasOn[k] && map.hasLayer(l)) map.removeLayer(l); });
        if (analysisLayer) { if (hadAnalysis && !map.hasLayer(analysisLayer)) analysisLayer.addTo(map); if (!hadAnalysis && map.hasLayer(analysisLayer)) map.removeLayer(analysisLayer); }
        map.setView(before.center, before.zoom, { animate: false });
        snapping = false;
      }
    },

    showGauges(gauges) {
      gaugeLayer.clearLayers();
      for (const g of gauges || []) {
        L.circleMarker([g.lat, g.lon], { radius: 6, weight: 2, fillOpacity: 0.8 })
          .bindTooltip(`${g.name}${g.river ? " (" + g.river + ")" : ""}`).addTo(gaugeLayer);
      }
    },
  };
})(typeof window !== "undefined" ? window : globalThis);
