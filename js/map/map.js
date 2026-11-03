// Creates the Leaflet map with an OpenStreetMap basemap, and the location marker.
(function (root) {
  "use strict";
  const FRC = (root.FRC = root.FRC || {});

  let map = null, marker = null, radiusCircle = null, gaugeLayer = null, analysisLayer = null;

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
      analysis.datasets.forEach((d) => (d.groups || []).forEach((g) => g.rows.forEach((r) => {
        if (!r.geometry) return;
        L.geoJSON(r.geometry, { interactive: true, style: { color: fill[r.rank] || "#5b8fd6", weight: 1, fillColor: fill[r.rank] || "#5b8fd6", fillOpacity: 0.55 } })
          .bindTooltip(`${g.group}: ${r.label}, ${FRC.util.fmtNum(r.area, 0)} m² (${r.percent.toFixed(1)}%)`, { sticky: true })
          .addTo(analysisLayer);
      })));
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
