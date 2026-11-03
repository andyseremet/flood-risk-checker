// Environment Agency (England): Flood Map for Planning zones, long-term risk
// band, live flood warnings and river gauges.
(function (root) {
  "use strict";
  const FRC = (root.FRC = root.FRC || {});
  const box = (lat, lon, d = 0.0005) => [lon - d, lat - d, lon + d, lat + d];

  FRC.ea = {
    // All Flood Zone 2 and 3 polygons whose bounding box touches bbox
    // [minLon, minLat, maxLon, maxLat]. Follows the service's "next" links.
    async zonesInBox(bbox, { pageSize = 500, maxPages = 10 } = {}) {
      let url = `${FRC.config.api.eaZones}?f=json&limit=${pageSize}&bbox=${bbox.join(",")}`;
      const features = [];
      let pages = 0, matched = null;
      while (url && pages < maxPages) {
        const d = await FRC.util.getJSON(url, 30000);
        pages++;
        if (Number.isFinite(d.numberMatched)) matched = d.numberMatched;
        features.push(...(Array.isArray(d.features) ? d.features : []));
        const next = (d.links || []).find((l) => l.rel === "next");
        url = next && (d.features || []).length ? next.href : null;
      }
      const partial = Boolean(url) || (matched != null && features.length < matched);
      return { features, partial, matched, retrieved: new Date() };
    },

    // Point check against Flood Zones 2 and 3. The service publishes only
    // Zones 2 and 3, so an empty result is NOT proof of Zone 1.
    async zoneAtPoint(lat, lon) {
      const b = box(lat, lon);
      const d = await FRC.util.getJSON(`${FRC.config.api.eaZones}?f=json&limit=50&bbox=${b.join(",")}`);
      const features = Array.isArray(d.features) ? d.features : [];
      const hits = features.filter((f) => FRC.util.inGeometry(lon, lat, f.geometry));
      const zones = hits.map((f) => f.properties && f.properties.flood_zone).filter(Boolean);
      const zone = zones.includes("FZ3") ? "FZ3" : zones.includes("FZ2") ? "FZ2" : null;
      const sources = [...new Set(hits.map((f) => f.properties && f.properties.flood_source).filter(Boolean))];
      return { zone, sources, matchedFeatures: hits.length, queriedFeatures: features.length, retrieved: new Date() };
    },

    async riskBand(lat, lon) {
      const d = 0.0005, bbox = [lat - d, lon - d, lat + d, lon + d].join(",");
      const url = `${FRC.config.api.eaRiskWms}?service=WMS&version=1.3.0&request=GetFeatureInfo&layers=rofrs_4band&query_layers=rofrs_4band&crs=EPSG:4326&bbox=${bbox}&width=101&height=101&i=50&j=50&info_format=application/json&feature_count=5`;
      const r = await FRC.util.getJSON(url);
      const f = (r.features || [])[0];
      // No feature here means "no risk band mapped at this point", not "very low".
      if (!f) return { band: null, raw: null, retrieved: new Date() };
      const p = f.properties || {};
      const key = Object.keys(p).find((k) => /risk|band|prob/i.test(k));
      return { band: key ? String(p[key]) : "See details", raw: p, retrieved: new Date() };
    },

    async liveWarnings(lat, lon, dist) {
      const r = await FRC.util.getJSON(`${FRC.config.api.eaFlood}/id/floods?lat=${lat}&long=${lon}&dist=${dist}`);
      return (r.items || []).map((i) => ({
        area: i.eaAreaName || "", description: i.description || (i.floodArea && i.floodArea.label) || "",
        severity: i.severity, level: i.severityLevel, raised: i.timeRaised, message: i.message || "",
      }));
    },

    async nearbyGauges(lat, lon, dist) {
      const r = await FRC.util.getJSON(`${FRC.config.api.eaFlood}/id/stations?lat=${lat}&long=${lon}&dist=${dist}&parameter=level`);
      const list = (r.items || []).filter((s) => typeof s.lat === "number")
        .map((s) => ({ id: s.notation || s.stationReference, name: s.label, river: s.riverName || "", lat: s.lat, lon: s.long, km: FRC.util.km(lat, lon, s.lat, s.long) }))
        .sort((a, b) => a.km - b.km).slice(0, 3);
      await Promise.all(list.map(async (g) => {
        try {
          const rr = await FRC.util.getJSON(`${FRC.config.api.eaFlood}/id/stations/${encodeURIComponent(g.id)}/readings?_sorted&_limit=1`);
          const it = (rr.items || [])[0];
          if (it) { g.value = it.value; g.time = it.dateTime; }
        } catch { /* keep the gauge without a reading */ }
      }));
      return list;
    },
  };
})(typeof window !== "undefined" ? window : globalThis);
