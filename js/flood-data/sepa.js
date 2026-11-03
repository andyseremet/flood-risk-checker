// SEPA (Scotland): river, surface water and coastal flood extents via the
// Flood_Maps ArcGIS MapServer "identify" operation.
(function (root) {
  "use strict";
  const FRC = (root.FRC = root.FRC || {});

  FRC.sepa = {
    // Returns e.g. { found: { River: "Medium", Coastal: "Low" }, retrieved }
    async floodAtPoint(lat, lon) {
      const d = 0.01;
      const params = new URLSearchParams({
        geometry: `${lon},${lat}`, geometryType: "esriGeometryPoint", sr: "4326",
        layers: "all:0,1,2,3,4,5,6,7,8", tolerance: "0",
        mapExtent: `${lon - d},${lat - d},${lon + d},${lat + d}`, imageDisplay: "400,400,96",
        returnGeometry: "false", f: "json",
      });
      const r = await FRC.util.getJSON(`${FRC.config.api.sepa}/identify?${params}`);
      const order = { High: 3, Medium: 2, Low: 1 };
      const found = {};
      for (const res of r.results || []) {
        const meta = FRC.config.sepaLayers[res.layerId];
        if (!meta) continue;
        const [src, lik] = meta;
        if (!found[src] || order[lik] > order[found[src]]) found[src] = lik;
      }
      return { found, retrieved: new Date() };
    },
  };
})(typeof window !== "undefined" ? window : globalThis);
