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

  function intersect(a, b) { if (!a || !b) return null; const r = T().intersect(a, b); return r && areaOf(r) > MIN_AREA ? r : null; }
  function union(a, b) { if (!a) return b; if (!b) return a; return T().union(a, b); }
  function difference(a, b) { if (!a) return null; if (!b) return a; const r = T().difference(a, b); return r && areaOf(r) > MIN_AREA ? r : null; }
  function unionAll(list) { return list.reduce((acc, f) => union(acc, f), null); }

  const toBNG = (g) => feat(FRC.projections.geometryToBNG(g));
  const toWGS = (f) => (f ? FRC.projections.geometryToWGS84(f.geometry) : null);

  const engine = {
    areaOf, intersect, union, difference, unionAll,

    // siteGeomsWGS: array of Polygon/MultiPolygon geometries (parcels) in WGS84.
    // items: normalised flood polygons (WGS84) for ONE group, e.g. England.
    // Returns rows per class with exclusive area, % of site and overlap notes.
    analyseGroup(siteGeomsWGS, items) {
      const site = unionAll(siteGeomsWGS.map(toBNG));
      const siteArea = areaOf(site);
      if (!site || siteArea <= 0) throw new Error("The site boundary has no area to analyse.");

      // Group polygons by class, clip each to the site, then union per class.
      const classes = new Map();
      for (const it of items) {
        const clipped = intersect(site, toBNG(it.geometry));
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
