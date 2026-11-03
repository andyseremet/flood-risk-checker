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

  const engine = {
    areaOf, intersect, union, difference, unionAll, snap,

    // The features (WGS84) that overlap the site by more than a sliver.
    touching(siteGeomsWGS, features) {
      const site = unionAll(siteGeomsWGS.map(toBNG));
      const sb = T().bbox(site), box = [sb[0] - 1, sb[1] - 1, sb[2] + 1, sb[3] + 1];
      return features.filter((f) => {
        if (!f.geometry) return false;
        try { return Boolean(intersect(site, clipToBox(toBNG(f.geometry), box))); } catch { return false; }
      });
    },

    // siteGeomsWGS: array of Polygon/MultiPolygon geometries (parcels) in WGS84.
    // items: normalised flood polygons (WGS84) for ONE group, e.g. England.
    // Returns rows per class with exclusive area, % of site and overlap notes.
    analyseGroup(siteGeomsWGS, items) {
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
        polygonsReturned: items.length,
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
