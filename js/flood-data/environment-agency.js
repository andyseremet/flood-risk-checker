// Environment Agency (England): Flood Map for Planning zones, long-term risk
// band, surface water, reservoir and recorded flood outlines, live flood
// warnings and river gauges.
(function (root) {
  "use strict";
  const FRC = (root.FRC = root.FRC || {});
  const box = (lat, lon, d = 0.0005) => [lon - d, lat - d, lon + d, lat + d];

  // Reads the attributes of a WMS layer at a point (GetFeatureInfo).
  // Servers differ in which response formats they support and in whether an
  // unsupported format is refused or answered with an empty result, so the
  // common formats are tried in turn. Returns the first feature's properties,
  // or null when every format answered with no feature. `tried` records each
  // attempt for the test page.
  const INFO_FORMATS = ["application/json", "application/geojson", "application/geo+json", "text/xml"];
  function parseInfo(text, format) {
    const t = text.trim();
    if (format !== "text/xml" || t.startsWith("{")) {
      const j = JSON.parse(t);
      const f = (j.features || j.results || [])[0];
      if (!f) return { props: null, count: (j.features || j.results || []).length };
      return { props: f.properties || f.attributes || {}, count: (j.features || j.results).length };
    }
    // ArcGIS: <FIELDS a="1" b="2"/>; GeoServer/MapServer GML: <layer_feature><name>v</name>…
    const fields = t.match(/<FIELDS\s([^>]*)\/?>/i);
    if (fields) {
      const props = {};
      fields[1].replace(/([\w:.-]+)="([^"]*)"/g, (m, k, v) => { props[k] = v; return m; });
      return { props, count: 1 };
    }
    const feat = t.match(/<(\w+:)?\w+_feature>([\s\S]*?)<\/(\w+:)?\w+_feature>/);
    if (feat) {
      const props = {};
      feat[2].replace(/<(?:\w+:)?(\w+)>([^<]*)<\/(?:\w+:)?\1>/g, (m, k, v) => { props[k] = v; return m; });
      return { props, count: 1 };
    }
    if (/ServiceException/i.test(t)) throw new Error("service exception: " + t.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 160));
    return { props: null, count: 0 };
  }
  async function wmsPointInfo(wmsUrl, layer, lat, lon) {
    const d = 0.0005, bbox = [lat - d, lon - d, lat + d, lon + d].join(",");
    const tried = [];
    let lastError = null;
    for (const format of INFO_FORMATS) {
      const url = `${wmsUrl}?service=WMS&version=1.3.0&request=GetFeatureInfo&layers=${layer}&query_layers=${layer}&styles=&crs=EPSG:4326&bbox=${bbox}&width=101&height=101&i=50&j=50&info_format=${encodeURIComponent(format)}&feature_count=5`;
      const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), 15000);
      try {
        const res = await fetch(url, { signal: ctrl.signal });
        const text = await res.text();
        if (!res.ok) throw new Error("HTTP " + res.status);
        const r = parseInfo(text, format);
        tried.push({ format, features: r.count, sample: text.slice(0, 200) });
        if (r.props) return { props: r.props, format, tried };
      } catch (e) {
        lastError = e.name === "AbortError" ? new Error("timed out after 15 s") : e;
        tried.push({ format, error: lastError.message.slice(0, 160) });
      } finally { clearTimeout(timer); }
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
