// Geometry tests: measurements and validation against boundaries with known
// areas. Run from this folder: npm install && npm test
const assert = require("assert");
const fs = require("fs");
const path = require("path");

globalThis.proj4 = require("proj4");
// The browser bundle is the same file the app loads from the CDN.
globalThis.turf = require(path.join(__dirname, "node_modules/@turf/turf/turf.min.js"));
require("../js/config.js");
require("../js/util.js");
require("../js/geometry/projections.js");
require("../js/geometry/measurements.js");
require("../js/boundary/boundary-validation.js");
const FRC = globalThis.FRC;

const fixture = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8"));
const measure = (obj) => {
  const v = FRC.boundaryValidation.validate(obj, "Test");
  return { v, m: v.features.length ? FRC.measurements.measureSite(v.features) : null };
};
const near = (actual, expected, tol, label) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${label}: expected ${expected} ± ${tol}, got ${actual}`);

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log("  ok  " + name); };

console.log("Geometry tests");

test("100 m square in BNG is detected, converted and measures 10,000 m²", () => {
  const { v, m } = measure(fixture("square-100m-bng.geojson"));
  assert.strictEqual(v.errors.length, 0);
  assert.ok(v.reprojected, "should be reprojected from EPSG:27700");
  near(m.area, 10000, 0.5, "area m²");
  near(m.hectares, 1.0, 0.0001, "hectares");
  near(m.acres, 2.471, 0.001, "acres");
  near(m.perimeter, 400, 0.05, "perimeter m");
  near(m.centroidBNG[0], 430050, 0.05, "centroid E");
  near(m.centroidBNG[1], 430050, 0.05, "centroid N");
});

test("BNG square without a crs member is still recognised as BNG", () => {
  const fc = fixture("square-100m-bng.geojson");
  delete fc.crs;
  const { v, m } = measure(fc);
  assert.ok(v.reprojected);
  near(m.area, 10000, 0.5, "area m²");
});

test("Polygon with a hole: 40,000 - 2,500 = 37,500 m²", () => {
  const { v, m } = measure(fixture("square-with-hole.geojson"));
  assert.strictEqual(v.errors.length, 0);
  assert.strictEqual(m.holes, 1);
  near(m.area, 37500, 1, "area m²");
  near(m.perimeter, 800, 0.1, "outer perimeter m");
  near(m.centroidBNG[0], 430100, 0.05, "centroid E (hole is symmetric)");
});

test("MultiPolygon of two 100 m squares measures 20,000 m²", () => {
  const { v, m } = measure(fixture("multipart.geojson"));
  assert.strictEqual(v.errors.length, 0);
  assert.strictEqual(m.parcels[0].parts, 2);
  near(m.area, 20000, 1, "area m²");
  near(m.perimeter, 800, 0.1, "perimeter m");
  near(m.centroidBNG[0], 430200, 0.05, "centroid E midway between squares");
});

test("Self-intersecting bow tie is rejected", () => {
  const { v } = measure(fixture("bowtie-invalid.geojson"));
  assert.strictEqual(v.features.length, 0);
  assert.ok(v.errors.some((e) => /crosses itself/.test(e)), v.errors.join(" | "));
});

test("Empty collection is rejected with a clear message", () => {
  const { v } = measure(fixture("empty.geojson"));
  assert.strictEqual(v.features.length, 0);
  assert.ok(v.errors.some((e) => /no geometry/.test(e)));
});

test("Points and lines are ignored with a warning", () => {
  const { v } = measure({ type: "FeatureCollection", features: [
    { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [-1.5, 53.8] } },
    fixture("square-with-hole.geojson"),
  ] });
  assert.strictEqual(v.features.length, 1);
  assert.ok(v.warnings.some((w) => /ignored/.test(w)));
});

test("Ring with too few corners is rejected", () => {
  const { v } = measure({ type: "Polygon", coordinates: [[[-1.5, 53.8], [-1.49, 53.8], [-1.5, 53.8]]] });
  assert.strictEqual(v.features.length, 0);
  assert.ok(v.errors.some((e) => /fewer than 3/.test(e)));
});

test("Unclosed ring is closed automatically", () => {
  const g = fixture("square-with-hole.geojson").geometry;
  const outer = g.coordinates[0].slice(0, -1);
  const { v, m } = measure({ type: "Polygon", coordinates: [outer] });
  assert.strictEqual(v.errors.length, 0);
  near(m.area, 40000, 1, "area m²");
});

test("Unsupported coordinate system is rejected", () => {
  const fc = fixture("square-with-hole.geojson");
  const { v } = measure({ type: "FeatureCollection", crs: { type: "name", properties: { name: "EPSG:3857" } }, features: [fc] });
  assert.ok(v.errors.some((e) => /not supported/.test(e)));
});

test("Shape outside the UK gives a warning", () => {
  const { v } = measure({ type: "Polygon", coordinates: [[[10, 45], [10.01, 45], [10.01, 45.01], [10, 45.01], [10, 45]]] });
  assert.ok(v.warnings.some((w) => /outside the UK/.test(w)));
});

test("Overlapping parcels are reported", () => {
  const a = fixture("square-with-hole.geojson");
  const b = JSON.parse(JSON.stringify(a));
  b.geometry.coordinates = [b.geometry.coordinates[0]]; // same outer square, no hole
  const { v } = measure({ type: "FeatureCollection", features: [a, b] });
  const o = FRC.boundaryValidation.overlaps(v.features);
  assert.strictEqual(o.length, 1);
  near(o[0].area, 37500, 2, "overlap m²");
});

test("A degenerate sliver hole is dropped with a warning; the parcel is kept", () => {
  const P = FRC.projections, e = 430000, n = 430000;
  const outer = [[e, n], [e + 100, n], [e + 100, n + 100], [e, n + 100], [e, n]];
  const hole = [[e + 10, n + 10], [e + 20, n + 20], [e + 10, n + 10]];
  const g = P.geometryToWGS84({ type: "Polygon", coordinates: [outer, hole] });
  const { v, m } = measure({ type: "Feature", properties: {}, geometry: g });
  assert.strictEqual(v.features.length, 1, "parcel kept");
  near(m.area, 10000, 1, "area m²");
  assert.ok(v.warnings.some((w) => /hole 1/.test(w)), "warning names the hole");
});

console.log(`\n${passed} tests passed`);
