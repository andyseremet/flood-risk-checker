// SEPA (Scotland): river, surface water and coastal flood extents via the
// Flood_Maps ArcGIS MapServer layer queries.
(function (root) {
  "use strict";
  const FRC = (root.FRC = root.FRC || {});

  FRC.sepa = {
    // Flood extent polygons from each SEPA layer that intersect the box.
    async extentsInBox(bbox) {
      const layerIds = Object.keys(FRC.config.sepaLayers).map(Number);
      const results = await Promise.all(layerIds.map(async (id) => {
        const params = new URLSearchParams({
          geometry: bbox.join(","), geometryType: "esriGeometryEnvelope", inSR: "4326",
          spatialRel: "esriSpatialRelIntersects", outFields: "OBJECTID", returnGeometry: "true",
          outSR: "4326", f: "geojson",
        });
        const r = await FRC.util.getJSON(`${FRC.config.api.sepa}/${id}/query?${params}`, 30000);
        if (r.error) throw new Error((r.error.message || "query failed") + " (layer " + id + ")");
        const partial = Boolean(r.exceededTransferLimit || (r.properties && r.properties.exceededTransferLimit));
        return { id, features: (r.features || []).map((f) => ({ ...f, properties: { ...(f.properties || {}), sepaLayer: id } })), partial };
      }));
      return {
        features: results.flatMap((r) => r.features),
        partial: results.some((r) => r.partial),
        retrieved: new Date(),
      };
    },

    // Returns e.g. { found: { River: "Medium", Coastal: "Low" }, retrieved }
    // Asks each layer whether it has a polygon at the point (a count only).
    // This is much quicker than the map service's "identify" across all
    // layers, which timed out on the live service.
    async floodAtPoint(lat, lon) {
      const order = { High: 3, Medium: 2, Low: 1 };
      const ids = Object.keys(FRC.config.sepaLayers).map(Number);
      const counts = await Promise.all(ids.map(async (id) => {
        const params = new URLSearchParams({
          geometry: `${lon},${lat}`, geometryType: "esriGeometryPoint", inSR: "4326",
          spatialRel: "esriSpatialRelIntersects", returnCountOnly: "true", f: "json",
        });
        const r = await FRC.util.getJSON(`${FRC.config.api.sepa}/${id}/query?${params}`, 30000);
        if (r.error) throw new Error((r.error.message || "query failed") + " (layer " + id + ")");
        return [id, Number(r.count) || 0];
      }));
      const found = {};
      for (const [id, n] of counts) {
        if (!n) continue;
        const [src, lik] = FRC.config.sepaLayers[id];
        if (!found[src] || order[lik] > order[found[src]]) found[src] = lik;
      }
      return { found, retrieved: new Date() };
    },
  };
})(typeof window !== "undefined" ? window : globalThis);
