// Polygon intersection engine. Works in British National Grid metres so the
// areas are planar and in m². Uses Turf's intersect / union / difference.
//
// Flood polygons are not assumed to form a clean, non-overlapping partition:
// - each class is unioned first, so overlapping polygons are counted once;
// - classes are then made exclusive in order of severity (rank), so an area
//   covered by both Zone 3 and Zone 2 polygons is reported once, as Zone 3;
// - the overlap between classes is reported separately;
// - the part of the site with no polygon at all is reported as
//   "no mapped polygon", never as a confirmed low-risk class.
(function (root) {
  "use strict";
  const FRC = (root.FRC = root.FRC || {});
  const T = () => { if (!root.turf) throw new Error("Turf.js is not loaded"); return root.turf; };

  const feat = (geometry) => ({ type: "Feature", properties: {}, geometry });
  const areaOf = (f) => (f ? FRC.measurements.measureBNG(f.geometry).area : 0);
  const MIN_AREA = 0.01; // m²; smaller slivers are rounding noise

  // Turf's clipping library can fail ("infinite loop", "call stack") when
  // polygons have edges that almost, but not exactly, coincide. That is common
  // where agencies' extents overlap along the same valley. Snapping every
  // coordinate to a fine grid in BNG metres makes such edges exactly equal.
  // 1 mm changes areas by far less than the data's own accuracy.
  const GRIDS = [0.001, 0.01, 0.1];
  function snapRing(r, q) {
    const out = [];
    for (const c of r) {
      const p = [Math.round(c[0] / q) * q, Math.round(c[1] / q) * q];
      const l = out[out.length - 1];
      if (!l || l[0] !== p[0] || l[1] !== p[1]) out.push(p);
    }
    if (out.length && (out[0][0] !== out[out.length - 1][0] || out[0][1] !== out[out.length - 1][1])) out.push(out[0].slice());
    return out.length >= 4 ? out : null;
  }
  const snapPoly = (rings, q) => { const o = snapRing(rings[0], q); return o ? [o, ...rings.slice(1).map((r) => snapRing(r, q)).filter(Boolean)] : null; };
  function snap(f, q = GRIDS[0]) {
    if (!f || !f.geometry) return null;
    const g = f.geometry;
    if (g.type === "Polygon") { const c = snapPoly(g.coordinates, q); return c ? feat({ type: "Polygon", coordinates: c }) : null; }
    if (g.type === "MultiPolygon") { const c = g.coordinates.map((p) => snapPoly(p, q)).filter(Boolean); return c.length ? feat({ type: "MultiPolygon", coordinates: c }) : null; }
    return null;
  }
  // Runs a Turf clipping operation on snapped inputs, retrying on a coarser
  // grid if the library fails.
  function safely(op, a, b) {
    let last;
    for (const q of GRIDS) {
      try { const r = op(snap(a, q), snap(b, q)); return r ? snap(r, GRIDS[0]) : null; } catch (e) { last = e; }
    }
    throw new Error("These flood polygons are too complex to measure in the browser (" + last.message.slice(0, 80) + ").");
  }

  function intersect(a, b) { if (!a || !b) return null; const r = safely((x, y) => (x && y ? T().intersect(x, y) : null), a, b); return r && areaOf(r) > MIN_AREA ? r : null; }
  function union(a, b) { if (!a) return b; if (!b) return a; return safely((x, y) => (x && y ? T().union(x, y) : x || y), a, b); }
  function difference(a, b) { if (!a) return null; if (!b) return a; const r = safely((x, y) => (x ? (y ? T().difference(x, y) : x) : null), a, b); return r && areaOf(r) > MIN_AREA ? r : null; }
  function unionAll(list) { return list.reduce((acc, f) => union(acc, f), null); }

  const toBNG = (g) => snap(feat(FRC.projections.geometryToBNG(g)));
  const toWGS = (f) => (f ? FRC.projections.geometryToWGS84(f.geometry) : null);
  // Cuts a large flood polygon down to the site's box (plus 1 m) before the
  // exact intersection. Reservoir and historic outlines can span many km.
  function clipToBox(f, box) {
    if (!f) return null;
    try { return snap(T().bboxClip(f, box)); } catch { return f; }
  }

  // Flood polygons can be enormous: a reservoir flood extent follows a whole
  // river valley, with hundreds of thousands of vertices. Projecting all of
  // them to BNG and clipping them took minutes at York. So each polygon is
  // first cut to the site's box in WGS84 (plus about 100 m), which is cheap
  // and leaves only the part near the site.
  const PAD_DEG = 0.0015;
  function wgsBox(siteGeomsWGS) {
    let a = [Infinity, Infinity, -Infinity, -Infinity];
    siteGeomsWGS.forEach((g) => FRC.projections.mapCoords(g, (c) => {
      a = [Math.min(a[0], c[0]), Math.min(a[1], c[1]), Math.max(a[2], c[0]), Math.max(a[3], c[1])];
      return c;
    }));
    return [a[0] - PAD_DEG, a[1] - PAD_DEG, a[2] + PAD_DEG, a[3] + PAD_DEG];
  }
  function preclipGeom(g, box) {
    if (!g || (g.type !== "Polygon" && g.type !== "MultiPolygon")) return g;
    let n = 0;
    (g.type === "Polygon" ? [g.coordinates] : g.coordinates).forEach((p) => p.forEach((r) => { n += r.length; }));
    if (n < 2000) return g; // small enough already
    try {
      const out = T().bboxClip(feat(g), box).geometry;
      const polys = (out.type === "Polygon" ? [out.coordinates] : out.coordinates)
        .map((p) => p.filter((r) => r.length >= 4)).filter((p) => p.length);
      if (!polys.length) return null;
      return polys.length === 1 ? { type: "Polygon", coordinates: polys[0] } : { type: "MultiPolygon", coordinates: polys };
    } catch { return g; }
  }
  const preclip = (siteGeomsWGS, items) => {
    const box = wgsBox(siteGeomsWGS);
    return items.map((it) => ({ ...it, geometry: preclipGeom(it.geometry, box) })).filter((it) => it.geometry);
  };

  const engine = {
    preclip,
    areaOf, intersect, union, difference, unionAll, snap,

    // The features (WGS84) that overlap the site by more than a sliver.
    touching(siteGeomsWGS, features) {
      const site = unionAll(siteGeomsWGS.map(toBNG));
      const sb = T().bbox(site), box = [sb[0] - 1, sb[1] - 1, sb[2] + 1, sb[3] + 1];
      const wbox = wgsBox(siteGeomsWGS);
      return features.filter((f) => {
        const g = preclipGeom(f.geometry, wbox);
        if (!g) return false;
        try { return Boolean(intersect(site, clipToBox(toBNG(g), box))); } catch {
          try { return engine.estimateGroup(siteGeomsWGS, [{ key: "x", label: "x", rank: 1, geometry: g }], null, 2000).coveredArea > MIN_AREA; } catch { return false; }
        }
      });
    },

    // siteGeomsWGS: array of Polygon/MultiPolygon geometries (parcels) in WGS84.
    // items: normalised flood polygons (WGS84) for ONE group, e.g. England.
    // Returns rows per class with exclusive area, % of site and overlap notes.
    // Exact areas from polygon clipping. If the clipping library still fails
    // on unusually complex data, areas are estimated from a sample grid so
    // the dataset gets a result instead of a processing error.
    analyseGroup(siteGeomsWGS, items) {
      try { return engine.exactGroup(siteGeomsWGS, items); } catch (e) {
        if (/no area to analyse/.test(e.message)) throw e;
        return engine.estimateGroup(siteGeomsWGS, items, e);
      }
    },

    // Estimate: lay a regular grid of about `target` points over the site,
    // and give each point inside the site to the most severe class whose
    // polygon contains it. Area = share of points x site area. Accurate to
    // roughly the grid spacing along each boundary (about 1% for 10,000 points).
    estimateGroup(siteGeomsWGS, allItems, cause, target = 10000) {
      const items = preclip(siteGeomsWGS, allItems);
      const parcels = siteGeomsWGS.map(toBNG).filter(Boolean);
      if (!parcels.length) throw new Error("The site boundary has no area to analyse.");
      let siteArea;
      try { siteArea = areaOf(unionAll(parcels)); } catch { siteArea = parcels.reduce((a, f) => a + areaOf(f), 0); }
      const bb = parcels.map((f) => T().bbox(f)).reduce((a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]);
      // Spacing comes from the site's own area, so a thin or diagonal site
      // still gets about `target` points inside it (capped at 2 million grid
      // cells over its bounding box).
      const bbArea = (bb[2] - bb[0]) * (bb[3] - bb[1]);
      const cell = Math.max(0.25, Math.sqrt(siteArea / target), Math.sqrt(bbArea / 2e6));
      // Each point is moved by a fixed pseudo-random amount within its cell
      // (a jittered grid), so the grid cannot line up with a straight edge.
      let seed = 0x2f6b1d;
      const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
      const box = [bb[0] - 1, bb[1] - 1, bb[2] + 1, bb[3] + 1];
      const inside = (x, y, f) => {
        const g = f.geometry, polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
        return polys.some((pl) => FRC.util.inRing(x, y, pl[0]) && !pl.slice(1).some((h) => FRC.util.inRing(x, y, h)));
      };
      // Each flood polygon is cut to the site's box first (Sutherland-Hodgman,
      // which does not fail on near-coincident edges).
      const polys = items.map((it) => {
        const f = clipToBox(toBNG(it.geometry), box);
        return f ? { it, f, bb: T().bbox(f) } : null;
      }).filter(Boolean);
      const meta = new Map();
      items.forEach((it) => { if (!meta.has(it.key)) meta.set(it.key, { key: it.key, label: it.label, rank: it.rank, n: 0, raw: 0 }); });
      let total = 0, coveredN = 0;
      for (let y0 = bb[1]; y0 < bb[3]; y0 += cell) {
        for (let x0 = bb[0]; x0 < bb[2]; x0 += cell) {
          const x = x0 + rand() * cell, y = y0 + rand() * cell;
          if (!parcels.some((f) => inside(x, y, f))) continue;
          total++;
          const hits = new Set();
          for (const p of polys) if (x >= p.bb[0] && x <= p.bb[2] && y >= p.bb[1] && y <= p.bb[3] && !hits.has(p.it.key) && inside(x, y, p.f)) hits.add(p.it.key);
          if (!hits.size) continue;
          coveredN++;
          let best = null;
          hits.forEach((k) => { const m = meta.get(k); m.raw++; if (!best || m.rank < best.rank) best = m; });
          best.n++;
        }
      }
      if (!total) throw cause;
      const share = (n) => (siteArea * n) / total;
      const ordered = [...meta.values()].sort((a, b) => a.rank - b.rank);
      const rows = ordered.filter((m) => m.raw > 0).map((m) => ({ key: m.key, label: m.label, rank: m.rank, area: share(m.n), rawArea: share(m.raw), percent: (100 * m.n) / total, geometry: null }));
      const overlaps = rows.filter((r) => r.rawArea - r.area > MIN_AREA).map((r) => ({ key: r.key, label: r.label, area: r.rawArea - r.area }));
      const coveredArea = share(coveredN), remainingArea = Math.max(0, siteArea - coveredArea);
      return {
        siteArea, rows, polygonsReturned: allItems.length, coveredArea,
        coveredPercent: (100 * coveredN) / total, remainingArea, remainingPercent: 100 - (100 * coveredN) / total,
        remainingGeometry: null, overlaps,
        extent: coveredN === 0 ? "none" : coveredN === total ? "whole" : "part",
        estimate: { points: total, spacing: cell, reason: cause && cause.message },
      };
    },

    exactGroup(siteGeomsWGS, allItems) {
      const items = preclip(siteGeomsWGS, allItems);
      const site = unionAll(siteGeomsWGS.map(toBNG));
      const siteArea = areaOf(site);
      if (!site || siteArea <= 0) throw new Error("The site boundary has no area to analyse.");

      // Group polygons by class, clip each to the site, then union per class.
      const sb = T().bbox(site), box = [sb[0] - 1, sb[1] - 1, sb[2] + 1, sb[3] + 1];
      const classes = new Map();
      for (const it of items) {
        const clipped = intersect(site, clipToBox(toBNG(it.geometry), box));
        if (!classes.has(it.key)) classes.set(it.key, { key: it.key, label: it.label, rank: it.rank, parts: [] });
        if (clipped) classes.get(it.key).parts.push(clipped);
      }
      const ordered = [...classes.values()].sort((a, b) => a.rank - b.rank);

      let covered = null;
      const rows = [], overlaps = [];
      for (const c of ordered) {
        const raw = unionAll(c.parts);
        const rawArea = areaOf(raw);
        const exclusive = difference(raw, covered);
        const exclusiveArea = areaOf(exclusive);
        if (raw && covered) {
          const ov = rawArea - exclusiveArea;
          if (ov > MIN_AREA) overlaps.push({ key: c.key, label: c.label, area: ov });
        }
        rows.push({ key: c.key, label: c.label, rank: c.rank, area: exclusiveArea, rawArea, percent: (100 * exclusiveArea) / siteArea, geometry: toWGS(exclusive) });
        covered = union(covered, raw);
      }
      const coveredArea = areaOf(covered);
      const remaining = difference(site, covered);
      const remainingArea = Math.max(0, siteArea - coveredArea);
      return {
        siteArea,
        rows: rows.filter((r) => r.rawArea > MIN_AREA),
        polygonsReturned: allItems.length,
        coveredArea,
        coveredPercent: (100 * coveredArea) / siteArea,
        remainingArea,
        remainingPercent: (100 * remainingArea) / siteArea,
        remainingGeometry: toWGS(remaining),
        overlaps,
        extent: coveredArea <= MIN_AREA ? "none" : remainingArea <= MIN_AREA ? "whole" : "part",
      };
    },
  };

  FRC.intersections = engine;
  if (typeof module !== "undefined" && module.exports) module.exports = engine;
})(typeof window !== "undefined" ? window : globalThis);
