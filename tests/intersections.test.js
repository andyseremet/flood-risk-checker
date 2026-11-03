// Intersection tests: a site and flood polygons with known geometry, built in
// British National Grid so the expected areas are exact.
// Run from this folder: npm install && npm test
const assert = require("assert");
const path = require("path");

globalThis.proj4 = require("proj4");
globalThis.turf = require(path.join(__dirname, "node_modules/@turf/turf/turf.min.js"));
require("../js/config.js");
require("../js/util.js");
require("../js/geometry/projections.js");
require("../js/geometry/measurements.js");
require("../js/flood-data/data-normalisation.js");
require("../js/analysis/intersections.js");
const FRC = globalThis.FRC;
const P = FRC.projections;

// Rectangle in BNG metres -> WGS84 Polygon geometry
const rect = (e, n, w, h) => P.geometryToWGS84({ type: "Polygon", coordinates: [[[e, n], [e + w, n], [e + w, n + h], [e, n + h], [e, n]]] });
const E0 = 430000, N0 = 430000;
const site = [rect(E0, N0, 100, 100)]; // 10,000 m²
const ea = (zone, geometry) => ({ geometry, properties: { flood_zone: zone, flood_source: "river" } });
const row = (res, key) => res.rows.find((r) => r.key === key);
const near = (a, e, tol, label) => assert.ok(Math.abs(a - e) <= tol, `${label}: expected ${e} ± ${tol}, got ${a}`);

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log("  ok  " + name); };
console.log("Intersection tests");

test("Spec example: 60% no polygon, 20% Zone 2, 20% Zone 3 (Zone 2 polygon also covers the Zone 3 area)", () => {
  const items = FRC.normalise.ea([
    ea("FZ3", rect(E0 - 50, N0 - 50, 70, 200)),  // covers x 0-20 of the site and extends outside it
    ea("FZ2", rect(E0 - 50, N0 - 50, 90, 200)),  // covers x 0-40, overlapping the Zone 3 strip
  ]);
  const r = FRC.intersections.analyseGroup(site, items);
  near(r.siteArea, 10000, 0.5, "site area");
  near(row(r, "FZ3").area, 2000, 0.5, "Zone 3 area");
  near(row(r, "FZ3").percent, 20, 0.01, "Zone 3 %");
  near(row(r, "FZ2").area, 2000, 0.5, "Zone 2 area (outside Zone 3)");
  near(row(r, "FZ2").rawArea, 4000, 0.5, "Zone 2 polygon area inside site");
  near(r.remainingArea, 6000, 0.5, "no polygon area");
  near(r.remainingPercent, 60, 0.01, "no polygon %");
  assert.strictEqual(r.extent, "part");
  assert.strictEqual(r.overlaps.length, 1);
  near(r.overlaps[0].area, 2000, 0.5, "Zone 2 / Zone 3 overlap");
});

test("Site entirely outside the flood polygons: nothing intersects, not called Zone 1", () => {
  const items = FRC.normalise.ea([ea("FZ3", rect(E0 + 500, N0, 100, 100))]);
  const r = FRC.intersections.analyseGroup(site, items);
  assert.strictEqual(r.rows.length, 0);
  assert.strictEqual(r.extent, "none");
  near(r.remainingArea, 10000, 0.5, "no polygon area");
});

test("Whole site in Zone 3", () => {
  const r = FRC.intersections.analyseGroup(site, FRC.normalise.ea([ea("FZ3", rect(E0 - 10, N0 - 10, 200, 200))]));
  near(row(r, "FZ3").percent, 100, 0.01, "Zone 3 %");
  assert.strictEqual(r.extent, "whole");
});

test("Overlapping polygons of the same zone are counted once", () => {
  const items = FRC.normalise.ea([ea("FZ2", rect(E0, N0, 60, 100)), ea("FZ2", rect(E0 + 30, N0, 50, 100))]);
  const r = FRC.intersections.analyseGroup(site, items);
  near(row(r, "FZ2").area, 8000, 0.5, "Zone 2 union area (x 0-80)");
});

test("Multi-parcel site with overlapping parcels uses the combined footprint", () => {
  const parcels = [rect(E0, N0, 100, 100), rect(E0 + 50, N0, 100, 100)]; // union = 150 x 100
  const r = FRC.intersections.analyseGroup(parcels, FRC.normalise.ea([ea("FZ3", rect(E0 + 100, N0, 100, 100))]));
  near(r.siteArea, 15000, 0.5, "site footprint");
  near(row(r, "FZ3").area, 5000, 0.5, "Zone 3 area");
});

test("Site with a hole: flood polygon inside the hole does not count", () => {
  const outer = [[E0, N0], [E0 + 100, N0], [E0 + 100, N0 + 100], [E0, N0 + 100], [E0, N0]];
  const hole = [[E0 + 40, N0 + 40], [E0 + 40, N0 + 60], [E0 + 60, N0 + 60], [E0 + 60, N0 + 40], [E0 + 40, N0 + 40]];
  const holed = [P.geometryToWGS84({ type: "Polygon", coordinates: [outer, hole] })];
  const r = FRC.intersections.analyseGroup(holed, FRC.normalise.ea([ea("FZ3", rect(E0 + 40, N0 + 40, 20, 20))]));
  near(r.siteArea, 9600, 0.5, "site area");
  assert.strictEqual(r.rows.length, 0);
});

test("SEPA likelihood bands are made exclusive, most likely first", () => {
  const f = (layer, g) => ({ geometry: g, properties: { sepaLayer: layer } });
  const items = FRC.normalise.sepa([f(0, rect(E0, N0, 10, 100)), f(1, rect(E0, N0, 30, 100)), f(2, rect(E0, N0, 50, 100))]);
  assert.ok(items.every((i) => i.group === "Scotland: River"));
  const r = FRC.intersections.analyseGroup(site, items);
  near(row(r, "River-High").area, 1000, 0.5, "High");
  near(row(r, "River-Medium").area, 2000, 0.5, "Medium only");
  near(row(r, "River-Low").area, 2000, 0.5, "Low only");
  near(r.remainingArea, 5000, 0.5, "no extent");
});

test("Unknown EA zone value is kept as its own class, not dropped", () => {
  const r = FRC.intersections.analyseGroup(site, FRC.normalise.ea([ea("", rect(E0, N0, 50, 100))]));
  assert.strictEqual(r.rows[0].key, "EA-other");
  near(r.rows[0].area, 5000, 0.5, "unclassified area");
});

test("Overlapping, detailed polygons with almost identical edges (as reservoir extents) do not break the clipping", () => {
  // Six 3,000-point outlines whose edges differ by fractions of a micrometre.
  // Before coordinate snapping, Turf failed on this case with
  // "Unable to complete output ring".
  let r = 1002;
  const rnd = () => ((r = (r * 16807) % 2147483647) / 2147483647);
  const outline = () => {
    const pts = [];
    for (let i = 0; i < 3000; i++) {
      const a = (2 * Math.PI * i) / 3000, rad = 500 + 50 * Math.sin(7 * a) + 1e-7 * (rnd() - 0.5);
      pts.push([E0 + rad * Math.cos(a) + 1e-9 * (rnd() - 0.5), N0 + rad * Math.sin(a)]);
    }
    pts.push(pts[0]);
    return P.geometryToWGS84({ type: "Polygon", coordinates: [pts] });
  };
  const big = [rect(E0 - 600, N0 - 600, 1200, 1200)];
  const items = FRC.normalise.eaReservoir(Array.from({ length: 6 }, () => ({ geometry: outline(), properties: {} })));
  const res = FRC.intersections.analyseGroup(big, items);
  assert.strictEqual(res.rows.length, 1);
  near(res.rows[0].area + res.remainingArea, 1440000, 1, "areas add up to the site");
  assert.ok(res.rows[0].percent > 50 && res.rows[0].percent < 70, "outline covers about 55% of the square, got " + res.rows[0].percent);
});

test("Estimate fallback: the 60/20/20 spec example from a sample grid is within 1%", () => {
  const items = FRC.normalise.ea([ea("FZ3", rect(E0 - 50, N0 - 50, 70, 200)), ea("FZ2", rect(E0 - 50, N0 - 50, 90, 200))]);
  const r = FRC.intersections.estimateGroup(site, items, new Error("test"));
  near(row(r, "FZ3").percent, 20, 1, "Zone 3 %");
  near(row(r, "FZ2").percent, 20, 1, "Zone 2 % (outside Zone 3)");
  near(r.remainingPercent, 60, 1, "no polygon %");
  assert.strictEqual(r.extent, "part");
  assert.ok(r.estimate.points > 9000, "uses about 10,000 points");
});

test("When exact clipping fails, analyseGroup returns an estimate instead of an error", () => {
  const exact = FRC.intersections.exactGroup;
  FRC.intersections.exactGroup = () => { throw new Error("Unable to complete output ring"); };
  try {
    const r = FRC.intersections.analyseGroup(site, FRC.normalise.ea([ea("FZ3", rect(E0, N0, 50, 100))]));
    assert.ok(r.estimate, "result is marked as an estimate");
    near(row(r, "FZ3").percent, 50, 1, "Zone 3 %");
  } finally { FRC.intersections.exactGroup = exact; }
});

test("A huge valley-wide polygon (300,000 vertices) is cut to the site first and measured quickly", () => {
  // A wavy ring about 20 km across around the site, with a straight edge
  // through the middle of the site so half of it is covered.
  const ring = [];
  const n = 300000, cx = E0 + 50, cy = N0 + 50, r = 10000;
  for (let i = 0; i < n; i++) {
    const t = Math.PI / 2 + (Math.PI * i) / (n - 1); // left half-circle, top to bottom
    const w = 1 + 0.02 * Math.sin(t * 4000);
    ring.push([cx + r * w * Math.cos(t), cy + r * w * Math.sin(t)]);
  }
  ring.push([cx, cy - r], [cx, cy + r], ring[0]);
  const big = P.geometryToWGS84({ type: "Polygon", coordinates: [ring] });
  const items = FRC.normalise.eaReservoir([{ geometry: big, properties: {} }]);
  const t0 = Date.now();
  const res = FRC.intersections.exactGroup(site, items);
  const ms = Date.now() - t0;
  near(row(res, "RES").percent, 50, 0.5, "reservoir extent %");
  assert.strictEqual(res.polygonsReturned, 1);
  assert.ok(ms < 3000, `took ${ms} ms`);
  const est = FRC.intersections.estimateGroup(site, items, null);
  near(row(est, "RES").percent, 50, 2, "estimated %");
  assert.strictEqual(FRC.intersections.touching(site, [{ geometry: big }]).length, 1);
});

console.log(`\n${passed} tests passed`);
