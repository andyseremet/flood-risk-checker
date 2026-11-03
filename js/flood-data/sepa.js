// SEPA (Scotland): river, surface water and coastal flood extents via the
// Flood_Maps ArcGIS MapServer layer queries.
(function (root) {
  "use strict";
  const FRC = (root.FRC = root.FRC || {});

  FRC.sepa = {
    // Flood extent polygons from each SEPA layer that intersect the box.
    // Only the PROB field is asked for: the surface water layers (3 to 5)
    // have no OBJECTID field (their id field is "fid"), so asking for
    // OBJECTID made SEPA answer "Failed to execute query" for them.
    // A layer that still fails is retried once with simplified geometry. If it still fails, the other layers are kept and the result
    // is marked partial with a note naming the missing layer.
    async extentsInBox(bbox) {
      const layerIds = Object.keys(FRC.config.sepaLayers).map(Number);
      const query = async (id, simplify) => {
        const params = new URLSearchParams({
          geometry: bbox.join(","), geometryType: "esriGeometryEnvelope", inSR: "4326",
          spatialRel: "esriSpatialRelIntersects", outFields: "PROB", returnGeometry: "true",
          outSR: "4326", f: "geojson",
        });
        if (simplify) params.set("maxAllowableOffset", "0.000005"); // about 0.5 m
        const r = await FRC.util.getJSON(`${FRC.config.api.sepa}/${id}/query?${params}`, 30000);
        if (r.error) throw new Error((r.error.message || "query failed") + " (layer " + id + ")");
        return r;
      };
      const results = await Promise.all(layerIds.map(async (id) => {
        let r;
        try { r = await query(id, false); } catch (e1) {
          try { r = await query(id, true); } catch (e2) { return { id, failed: e2.message }; }
        }
        const partial = Boolean(r.exceededTransferLimit || (r.properties && r.properties.exceededTransferLimit));
        return { id, features: (r.features || []).map((f) => ({ ...f, properties: { ...(f.properties || {}), sepaLayer: id } })), partial };
      }));
      const failed = results.filter((r) => r.failed);
      if (failed.length === results.length) throw new Error(failed[0].failed);
      const name = (id) => { const [src, lik] = FRC.config.sepaLayers[id]; return `${src} ${lik.toLowerCase()} likelihood`; };
      return {
        features: results.flatMap((r) => r.features || []),
        partial: results.some((r) => r.partial) || failed.length > 0,
        notes: failed.length ? [`SEPA did not return these layers, so they are missing from the result: ${failed.map((r) => name(r.id)).join(", ")}. Check them on SEPA's flood map.`] : [],
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
