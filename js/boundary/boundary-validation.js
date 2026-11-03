// Checks a site boundary before it is measured or analysed.
// Input: any parsed GeoJSON object. Output: clean WGS84 polygon Features plus
// a list of errors (stop) and warnings (continue, but tell the analyst).
// Uses the turf global for self-intersection checks when it is available.
(function (root) {
  "use strict";
  const FRC = (root.FRC = root.FRC || {});

  const isPos = (c) => Array.isArray(c) && c.length >= 2 && Number.isFinite(c[0]) && Number.isFinite(c[1]);

  // Collect every geometry from Feature / FeatureCollection / Geometry / GeometryCollection.
  function flatten(obj, props, out) {
    if (!obj || typeof obj !== "object") return out;
    if (obj.type === "FeatureCollection") (obj.features || []).forEach((f) => flatten(f, null, out));
    else if (obj.type === "Feature") flatten(obj.geometry, obj.properties || {}, out);
    else if (obj.type === "GeometryCollection") (obj.geometries || []).forEach((g) => flatten(g, props, out));
    else if (obj.type) out.push({ geometry: obj, properties: props || {} });
    return out;
  }

  // Guess whether coordinates are British National Grid metres rather than lon/lat.
  function looksLikeBNG(items) {
    const xs = [], ys = [];
    items.forEach((it) => FRC.projections.mapCoords(it.geometry, (c) => { xs.push(c[0]); ys.push(c[1]); return c; }));
    if (!xs.length) return false;
    const outsideLonLat = xs.some((x) => Math.abs(x) > 180) || ys.some((y) => Math.abs(y) > 90);
    const inBNG = xs.every((x) => x >= -10000 && x <= 800000) && ys.every((y) => y >= -10000 && y <= 1300000);
    return outsideLonLat && inBNG;
  }

  function declaredCRS(obj) {
    const name = obj && obj.crs && obj.crs.properties && obj.crs.properties.name;
    return name ? String(name) : null;
  }

  // Remove repeated consecutive points and close the ring if needed.
  function cleanRing(ring) {
    const out = [];
    for (const c of ring) {
      const p = [c[0], c[1]];
      const last = out[out.length - 1];
      if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p);
    }
    if (out.length && (out[0][0] !== out[out.length - 1][0] || out[0][1] !== out[out.length - 1][1])) out.push([out[0][0], out[0][1]]);
    return out;
  }

  const validation = {
    looksLikeBNG,

    // Returns { features, errors[], warnings[], reprojected }
    validate(input, label = "Boundary") {
      const errors = [], warnings = [];
      let items = flatten(input, null, []);
      if (!items.length) return { features: [], errors: [label + " contains no geometry."], warnings, reprojected: false };

      // Coordinate system: GeoJSON should be WGS84, but files exported from QGIS
      // in British National Grid are common. Detect and convert them.
      let reprojected = false;
      const crs = declaredCRS(input);
      if ((crs && /27700/.test(crs)) || looksLikeBNG(items)) {
        items = items.map((it) => ({ ...it, geometry: FRC.projections.geometryToWGS84(it.geometry) }));
        reprojected = true;
        warnings.push(label + " was in British National Grid (EPSG:27700). It has been converted to WGS84 for the map.");
      } else if (crs && !/4326|CRS84/i.test(crs)) {
        errors.push(label + " uses coordinate system " + crs + ", which is not supported. Export it as WGS84 (EPSG:4326) or British National Grid (EPSG:27700).");
        return { features: [], errors, warnings, reprojected };
      }

      const features = [];
      let skipped = 0;
      items.forEach((it, idx) => {
        const g = it.geometry;
        const name = it.properties.name || it.properties.Name || it.properties.NAME || null;
        if (!g || (g.type !== "Polygon" && g.type !== "MultiPolygon")) { skipped++; return; }
        const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
        if (!Array.isArray(polys) || !polys.length) { errors.push(`Shape ${idx + 1} is empty.`); return; }

        const cleanPolys = [];
        polys.forEach((poly, pi) => {
          const where = `Shape ${idx + 1}${polys.length > 1 ? ` part ${pi + 1}` : ""}`;
          if (!Array.isArray(poly) || !poly.length) { errors.push(where + " is empty."); return; }
          const rings = [];
          for (const [ri, ring] of poly.entries()) {
            if (!Array.isArray(ring) || !ring.every(isPos)) { errors.push(where + " has invalid coordinates."); return; }
            const r = cleanRing(ring);
            if (r.length < 4) { errors.push(`${where}${ri ? " (hole " + ri + ")" : ""} has fewer than 3 distinct corners.`); return; }
            rings.push(r);
          }
          if (Math.abs(FRC.measurements.ringSignedArea(rings[0])) === 0) { errors.push(where + " has zero area."); return; }
          cleanPolys.push(rings);
        });
        if (!cleanPolys.length) return;

        const geometry = cleanPolys.length === 1 ? { type: "Polygon", coordinates: cleanPolys[0] } : { type: "MultiPolygon", coordinates: cleanPolys };
        const f = { type: "Feature", properties: { ...it.properties, name: name || undefined }, geometry };

        if (root.turf && root.turf.kinks) {
          const k = root.turf.kinks(f);
          if (k.features.length) {
            errors.push(`Shape ${idx + 1}${name ? " (" + name + ")" : ""} crosses itself at ${k.features.length} point${k.features.length > 1 ? "s" : ""}. Redraw it so the edges do not cross.`);
            return;
          }
        }

        const b = FRC.config.ukBounds;
        let outside = false;
        FRC.projections.mapCoords(geometry, (c) => { if (c[0] < b.minLon || c[0] > b.maxLon || c[1] < b.minLat || c[1] > b.maxLat) outside = true; return c; });
        if (outside) warnings.push(`Shape ${idx + 1} is partly or wholly outside the UK. Check the file's coordinate system.`);

        features.push(f);
      });

      if (skipped) warnings.push(`${skipped} point or line shape${skipped > 1 ? "s were" : " was"} ignored. Only polygons can be site boundaries.`);
      if (!features.length && !errors.length) errors.push(label + " contains no polygons.");
      return { features, errors, warnings, reprojected };
    },

    // Warn when parcels overlap each other (their areas would be counted twice).
    overlaps(features) {
      const out = [];
      if (!(root.turf && root.turf.intersect)) return out;
      for (let i = 0; i < features.length; i++) {
        for (let j = i + 1; j < features.length; j++) {
          try {
            const x = root.turf.intersect(features[i], features[j]);
            if (x) {
              const a = FRC.measurements.measureBNG(FRC.projections.geometryToBNG(x.geometry)).area;
              if (a > 0.01) out.push({ i, j, area: a });
            }
          } catch { /* a failed overlap test should not block measuring */ }
        }
      }
      return out;
    },
  };

  FRC.boundaryValidation = validation;
  if (typeof module !== "undefined" && module.exports) module.exports = validation;
})(typeof window !== "undefined" ? window : globalThis);
