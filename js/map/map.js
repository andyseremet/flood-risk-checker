// Creates the Leaflet map with an OpenStreetMap basemap, and the location marker.
(function (root) {
  "use strict";
  const FRC = (root.FRC = root.FRC || {});

  let map = null, marker = null, radiusCircle = null, gaugeLayer = null;

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

    showGauges(gauges) {
      gaugeLayer.clearLayers();
      for (const g of gauges || []) {
        L.circleMarker([g.lat, g.lon], { radius: 6, weight: 2, fillOpacity: 0.8 })
          .bindTooltip(`${g.name}${g.river ? " (" + g.river + ")" : ""}`).addTo(gaugeLayer);
      }
    },
  };
})(typeof window !== "undefined" ? window : globalThis);
