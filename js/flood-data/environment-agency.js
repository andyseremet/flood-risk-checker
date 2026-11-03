// Environment Agency (England): Flood Map for Planning zones, long-term risk
// band, surface water, reservoir and recorded flood outlines, live flood
// warnings and river gauges.
(function (root) {
  "use strict";
  const FRC = (root.FRC = root.FRC || {});
  const box = (lat, lon, d = 0.0005) => [lon - d, lat - d, lon + d, lat + d];

  // Reads the attributes of a WMS layer at a point (GetFeatureInfo).
  // Returns the first feature's properties, or null when every attempt
  // answered with no feature. `tried` records each attempt for the test page.
  function parseInfo(text) {
    const j = JSON.parse(text);
    const list = j.features || [];
    return { props: list[0] ? list[0].properties || {} : null, count: list.length };
  }

  // The live service (GeoServer) answered an EPSG:4326 point query with no
  // feature inside Flood Zone 3 at York, while its map images draw correctly
  // in Web Mercator. So the point is asked for first in Web Mercator (the
  // same system as the map), then in British National Grid, then in the
  // two EPSG:4326 axis orders. A small pixel buffer helps at polygon edges.
  function pointQueries(lat, lon) {
    const R = 6378137, x = (R * lon * Math.PI) / 180, y = R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
    const m = 25; // metres either side
    const [e, n] = FRC.projections.toBNG([lon, lat]);
    const d = 0.0005;
    return [
      { system: "EPSG:3857", q: `version=1.3.0&crs=EPSG:3857&bbox=${[x - m, y - m, x + m, y + m].join(",")}&i=50&j=50` },
      { system: "EPSG:27700", q: `version=1.3.0&crs=EPSG:27700&bbox=${[e - m, n - m, e + m, n + m].join(",")}&i=50&j=50` },
      { system: "EPSG:4326 lat,lon", q: `version=1.3.0&crs=EPSG:4326&bbox=${[lat - d, lon - d, lat + d, lon + d].join(",")}&i=50&j=50` },
      { system: "EPSG:4326 lon,lat (WMS 1.1.1)", q: `version=1.1.1&srs=EPSG:4326&bbox=${[lon - d, lat - d, lon + d, lat + d].join(",")}&x=50&y=50` },
    ];
  }
  async function wmsPointInfo(wmsUrl, layer, lat, lon) {
    const tried = [];
    let lastError = null;
    for (const { system, q } of pointQueries(lat, lon)) {
      const url = `${wmsUrl}?service=WMS&request=GetFeatureInfo&layers=${layer}&query_layers=${layer}&styles=&${q}&width=101&height=101&info_format=application/json&feature_count=5&buffer=3`;
      // One retry: the surface water service sometimes drops a request.
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const text = await FRC.util.limited(async () => {
            const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), 15000);
            try {
              const res = await fetch(url, { signal: ctrl.signal });
              const body = await res.text();
              if (!res.ok) throw new Error("HTTP " + res.status);
              return body;
            } finally { clearTimeout(timer); }
          });
          const r = parseInfo(text);
          tried.push({ system, features: r.count, ...(r.count ? {} : { sample: text.slice(0, 120) }) });
          if (r.props) return { props: r.props, format: system, tried };
          break;
        } catch (e) {
          lastError = e.name === "AbortError" ? new Error("timed out after 15 s") : e;
          lastError.url = url;
          if (attempt === 2) tried.push({ system, error: lastError.message.slice(0, 160) });
          else await new Promise((r) => setTimeout(r, 1500));
        }
      }
    }
    if (tried.every((t) => t.error)) throw lastError;
    return { props: null, format: null, tried };
  }

  // All features of an OGC API Features collection whose bounding box touches
  // bbox [minLon, minLat, maxLon, maxLat]. Follows the service's "next" links.
  async function itemsInBox(itemsUrl, bbox, { pageSize = 500, maxPages = 10 } = {}) {
    let url = `${itemsUrl}?f=json&limit=${pageSize}&bbox=${bbox.join(",")}`;
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
  }

  FRC.ea = {
    itemsInBox,

    // Flood Zone 2 and 3 polygons (Flood Map for Planning, rivers and sea).
    zonesInBox: (bbox, opts) => itemsInBox(FRC.config.api.eaZones, bbox, opts),

    // Reservoir flood extents (wet day): the area that could flood if a large
    // raised reservoir failed while rivers are already in flood. Credible worst
    // case with no likelihood attached.
    reservoirInBox: (bbox, opts) => itemsInBox(FRC.config.api.eaReservoir, bbox, opts),

    // Recorded flood outlines: areas that have flooded in the past. Outlines
    // can be large and detailed, so smaller pages are requested.
    recordedInBox: (bbox, opts) => itemsInBox(FRC.config.api.eaRecorded, bbox, { pageSize: 100, maxPages: 10, ...opts }),

    // Risk of Flooding from Surface Water (NaFRA2). Published as map images
    // only (WMS), so it can be checked at points but not measured as an area.
    async surfaceWaterAtPoint(lat, lon) {
      const r = await wmsPointInfo(FRC.config.api.eaSurfaceWms, "rofsw", lat, lon);
      // No feature means "no surface water risk band mapped at this point", not "very low".
      if (!r.props) return { band: null, raw: null, tried: r.tried, retrieved: new Date() };
      const key = Object.keys(r.props).find((k) => /band|risk|prob|likel|chance/i.test(k));
      return { band: key ? String(r.props[key]) : "Mapped (band not stated in data)", raw: r.props, format: r.format, tried: r.tried, retrieved: new Date() };
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
      const r = await wmsPointInfo(FRC.config.api.eaRiskWms, "rofrs_4band", lat, lon);
      // No feature here means "no risk band mapped at this point", not "very low".
      if (!r.props) return { band: null, raw: null, tried: r.tried, retrieved: new Date() };
      const key = Object.keys(r.props).find((k) => /risk|band|prob/i.test(k));
      return { band: key ? String(r.props[key]) : "See details", raw: r.props, format: r.format, tried: r.tried, retrieved: new Date() };
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
      // A station can record several measures (level, flow, upstream and
      // downstream of a weir). Use its river level measure, preferring the
      // "Stage" (main) one, and show that measure's own unit.
      const stations = new Map((r.items || []).map((s) => [s.notation || s.stationReference, s]));
      await Promise.all(list.map(async (g) => {
        try {
          const st = stations.get(g.id) || {};
          let measures = Array.isArray(st.measures) ? st.measures : st.measures ? [st.measures] : [];
          if (!measures.length) measures = (await FRC.util.getJSON(`${FRC.config.api.eaFlood}/id/stations/${encodeURIComponent(g.id)}/measures`)).items || [];
          const levels = measures.filter((m) => m.parameter === "level");
          const m = levels.find((x) => /stage/i.test(x.qualifier || "")) || levels[0];
          if (!m || !m["@id"]) return;
          const id = String(m["@id"]).split("/").pop();
          const rr = await FRC.util.getJSON(`${FRC.config.api.eaFlood}/id/measures/${encodeURIComponent(id)}/readings?latest`);
          const it = (rr.items || [])[0];
          if (it && typeof it.value === "number") { g.value = it.value; g.time = it.dateTime; g.unit = m.unitName || "m"; }
        } catch { /* keep the gauge without a reading */ }
      }));
      return list;
    },
  };
})(typeof window !== "undefined" ? window : globalThis);
