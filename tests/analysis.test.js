// Site analysis tests with the data services replaced by fixed responses.
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
require("../js/analysis/flood-analysis.js");
const FRC = globalThis.FRC;
const P = FRC.projections;

const rect = (e, n, w, h) => P.geometryToWGS84({ type: "Polygon", coordinates: [[[e, n], [e + w, n], [e + w, n + h], [e, n + h], [e, n]]] });
const E0 = 430000, N0 = 430000;
const site = [{ type: "Feature", properties: {}, geometry: rect(E0, N0, 100, 100) }];
const ok = (features) => async () => ({ features, partial: false, retrieved: new Date() });

let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log("  ok  " + name); };

(async () => {
  console.log("Site analysis tests");

  await test("England: reservoir and recorded outlines measured, named in notes; surface water checked at the centroid", async () => {
    FRC.ea = {
      zonesInBox: ok([]),
      reservoirInBox: ok([
        { geometry: rect(E0 - 50, N0 - 50, 100, 200), properties: { reservoir: "Example Reservoir", undertaker: "Water Co", risk_designation: "High risk" } },
        { geometry: rect(E0 + 1000, N0, 50, 50), properties: { reservoir: "Far Reservoir" } },
      ]),
      recordedInBox: ok([{ geometry: rect(E0, N0, 100, 30), properties: { name: "Winter 2000", start_date: "2000-11-01T00:00:00Z", flood_src: "main river" } }]),
      surfaceWaterAtPoint: async () => ({ band: "Medium", retrieved: new Date() }),
    };
    const a = await FRC.floodAnalysis.analyseSite(site, "England");
    const by = (id) => a.datasets.find((d) => d.id === id);

    const zones = by("ea");
    assert.strictEqual(zones.status, "none");
    assert.ok(zones.notes.some((n) => /Flood Zone 1/.test(n)), "zones note must say this is not Flood Zone 1");

    const res = by("ea-res");
    assert.strictEqual(res.status, "completed");
    assert.ok(Math.abs(res.groups[0].rows[0].percent - 50) < 0.01, "reservoir covers half the site");
    assert.ok(res.notes.some((n) => /Example Reservoir/.test(n) && !/Far Reservoir/.test(n)), "only reservoirs that reach the site are named");

    const rec = by("ea-rec");
    assert.ok(Math.abs(rec.groups[0].rows[0].percent - 30) < 0.01, "recorded outline covers 30%");
    assert.ok(rec.notes.some((n) => /Winter 2000/.test(n) && /main river/.test(n)));

    const sw = by("ea-sw");
    assert.strictEqual(sw.status, "completed");
    assert.match(sw.summary, /Medium/);
    assert.ok(sw.notes.some((n) => /centroid only/.test(n)));

    assert.strictEqual(by("gw").status, "notAssessed");
    assert.strictEqual(by("nrw").status, "notAssessed");
    assert.strictEqual(by("sepa").status, "notAssessed");
  });

  await test("England: nothing mapped and a service down give explicit statuses, never 'safe'", async () => {
    FRC.ea = {
      zonesInBox: ok([]),
      reservoirInBox: ok([]),
      recordedInBox: async () => { throw new Error("HTTP 503"); },
      surfaceWaterAtPoint: async () => ({ band: null, retrieved: new Date() }),
    };
    const a = await FRC.floodAnalysis.analyseSite(site, "England");
    const by = (id) => a.datasets.find((d) => d.id === id);
    assert.strictEqual(by("ea-res").status, "none");
    assert.ok(by("ea-res").notes.some((n) => /does not establish/.test(n)));
    assert.strictEqual(by("ea-rec").status, "unavailable");
    assert.strictEqual(by("ea-sw").status, "none");
    assert.ok(by("ea-sw").notes.some((n) => /does not establish/.test(n)));
  });

  await test("Scotland: England-only datasets are not assessed, with the reason", async () => {
    FRC.sepa = { extentsInBox: ok([]) };
    const a = await FRC.floodAnalysis.analyseSite(site, "Scotland");
    const res = a.datasets.find((d) => d.id === "ea-res");
    assert.strictEqual(res.status, "notAssessed");
    assert.match(res.notes[0], /not in England/);
  });

  console.log(`\n${passed} tests passed`);
})().catch((e) => { console.error(e); process.exit(1); });
