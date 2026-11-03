// Creates the Leaflet map with an OpenStreetMap basemap, and the location marker.
(function (root) {
  "use strict";
  const FRC = (root.FRC = root.FRC || {});

  let map = null, marker = null, radiusCircle = null, gaugeLayer = null, analysisLayer = null;
  let snapQueue = Promise.resolve();
  const takeSnapshot = (opts) => FRC.map._snapshot(opts);

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

  FRC.map = {
    init(elementId) {
      map = L.map(elementId, { zoomControl: true }).setView([54.3, -2.5], 6);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19, crossOrigin: true, attribution: "© OpenStreetMap contributors",
      }).addTo(map);
      gaugeLayer = L.layerGroup().addTo(map);
      L.control.scale({ imperial: false }).addTo(map);
      return map;
    },
    get() { return map; },

    // Show the checked location and the search radius.
    showPoint(lat, lon, distKm, { fit = true } = {}) {
      if (marker) marker.remove();
      if (radiusCircle) radiusCircle.remove();
      gaugeLayer.clearLayers();
      marker = L.marker([lat, lon], { title: "Checked location" }).addTo(map);
      const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#0b6e8a";
      radiusCircle = L.circle([lat, lon], { radius: distKm * 1000, color: accent, weight: 1, fillOpacity: 0.04, interactive: false }).addTo(map);
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

    // Capture the map as an image for the PDF with a given view and overlays,
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

    async _snapshot({ view, overlays = [], analysis = false, width = 900, height = 600 }) {
      const el = map.getContainer();
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
        await waitForTiles(map, 8000);
        const canvas = await root.html2canvas(el, { useCORS: true, logging: false, scale: 1, ignoreElements: (n) => n.classList && n.classList.contains("leaflet-control-container") });
        return { img: canvas.toDataURL("image/jpeg", 0.85), w: canvas.width, h: canvas.height };
      } finally {
        Object.assign(el.style, style);
        map.invalidateSize(false);
        Object.entries(layers).forEach(([k, l]) => { if (wasOn[k] && !map.hasLayer(l)) l.addTo(map); if (!wasOn[k] && map.hasLayer(l)) map.removeLayer(l); });
        if (analysisLayer) { if (hadAnalysis && !map.hasLayer(analysisLayer)) analysisLayer.addTo(map); if (!hadAnalysis && map.hasLayer(analysisLayer)) map.removeLayer(analysisLayer); }
        map.setView(before.center, before.zoom, { animate: false });
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
