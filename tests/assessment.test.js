// Tests for the risk-by-source table and the "is a full FRA needed?" answer.
// Run from this folder: npm test
const assert = require("assert");
require("../js/reporting/assessment.js");
const A = globalThis.FRC.assessment;

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log("  ok  " + name); };

const row = (key, label, rank, percent) => ({ key, label, rank, percent, area: percent * 10 });
const ds = (id, nation, status, groups = [], extra = {}) => ({ id, nation, status, statusText: status, groups, notes: [], ...extra });
const group = (name, rows) => ({ group: name, rows });
const england = (zoneRows, opts = {}) => ({
  nation: "England", notes: [],
  datasets: [
    ds("ea", "England", zoneRows.length ? "completed" : "none", [group("England", zoneRows)]),
    ds("ea-sw", "England", opts.sw ? "completed" : "none", [], { band: opts.sw || null }),
    ds("ea-res", "England", "none", [group("England: Reservoir", [])]),
    ds("ea-rec", "England", opts.rec ? "completed" : "none", [group("England: Recorded floods", opts.rec ? [row("REC", "Recorded", 1, opts.rec)] : [])]),
    ds("nrw", "Wales", "notAssessed"), ds("sepa", "Scotland", "notAssessed"), ds("gw", "All", "notAssessed"),
  ],
});
const site = (ha) => ({ features: [{}], measured: { hectares: ha } });
const get = (rows, s) => rows.find((r) => r.source === s);

console.log("Assessment tests");

test("England site in Flood Zone 3: rivers rated High, FRA likely, Product 4 suggested", () => {
  const a = england([row("FZ3", "Flood Zone 3", 1, 23.6), row("FZ2", "Flood Zone 2", 2, 15.1)], { rec: 39.8 });
  const rows = A.riskBySource({ analysis: a, nation: "England" });
  assert.strictEqual(get(rows, "Rivers and sea").rating, "High");
  assert.match(get(rows, "Rivers and sea").evidence, /23\.6% .*Flood Zone 3, 15\.1% in Flood Zone 2/);
  assert.strictEqual(get(rows, "Historic flooding").rating, "Flooded before");
  assert.strictEqual(get(rows, "Groundwater").rating, "Not assessed");
  assert.strictEqual(get(rows, "Sewers").rating, "Not assessed");
  assert.deepStrictEqual(rows.map((r) => r.source), ["Rivers and sea", "Surface water", "Groundwater", "Sewers", "Reservoirs", "Historic flooding"]);
  const f = A.fraNeed({ analysis: a, site: site(0.5), nation: "England", rows });
  assert.strictEqual(f.verdict, "likely");
  assert.ok(f.actions.some((t) => /Product 4/.test(t)));
});

test("England small site with nothing mapped: None mapped (never Low or Zone 1), not triggered", () => {
  const a = england([]);
  const rows = A.riskBySource({ analysis: a, nation: "England" });
  const r = get(rows, "Rivers and sea");
  assert.strictEqual(r.rating, "None mapped");
  assert.match(r.evidence, /not a Flood Zone 1/);
  assert.ok(!rows.some((x) => x.rating === "Low"));
  const f = A.fraNeed({ analysis: a, site: site(0.4), nation: "England", rows });
  assert.strictEqual(f.verdict, "notTriggered");
  assert.ok(f.actions.some((t) => /planning authority/.test(t)));
});

test("England site of 1 ha or more in Zone 1: FRA likely because of size", () => {
  const f = A.fraNeed({ analysis: england([]), site: site(1.2), nation: "England" });
  assert.strictEqual(f.verdict, "likely");
  assert.ok(f.reasons.some((t) => /1\.20 ha/.test(t)));
});

test("Pin area (600 m circle): no 1 ha trigger, and the user is told to add the real boundary", () => {
  const f = A.fraNeed({ analysis: england([]), site: { auto: true, features: [{}], measured: { hectares: 113 } }, nation: "England" });
  assert.strictEqual(f.verdict, "notTriggered");
  assert.ok(f.actions.some((t) => /600 m area around the pin/.test(t)));
});

test("England surface water band at the centroid: FRA may be needed", () => {
  const a = england([], { sw: "Low" });
  const rows = A.riskBySource({ analysis: a, nation: "England" });
  assert.strictEqual(get(rows, "Surface water").rating, "Low");
  assert.strictEqual(A.fraNeed({ analysis: a, site: site(0.3), nation: "England", rows }).verdict, "possible");
});

test("Flood zone service down: No result, and the answer is unclear", () => {
  const a = england([]);
  a.datasets[0] = ds("ea", "England", "unavailable", [], { statusText: "Service unavailable", error: "timed out" });
  const rows = A.riskBySource({ analysis: a, nation: "England" });
  assert.strictEqual(get(rows, "Rivers and sea").rating, "No result");
  assert.strictEqual(A.fraNeed({ analysis: a, site: site(0.3), nation: "England", rows }).verdict, "unclear");
});

test("Scotland: rivers, sea and surface water rated from SEPA likelihood bands", () => {
  const a = { nation: "Scotland", notes: [], datasets: [
    ds("ea", "England", "notAssessed"),
    ds("sepa", "Scotland", "completed", [group("Scotland: River", [row("River-Medium", "Medium likelihood (1 in 200 each year)", 2, 12), row("River-Low", "Low likelihood (1 in 1,000 each year)", 3, 8)]),
      group("Scotland: Surface water", [row("Surface water-Low", "Low likelihood (1 in 1,000 each year)", 3, 4)])]),
  ] };
  const rows = A.riskBySource({ analysis: a, nation: "Scotland" });
  assert.strictEqual(get(rows, "Rivers").rating, "Medium");
  assert.strictEqual(get(rows, "Sea").rating, "None mapped");
  assert.strictEqual(get(rows, "Surface water").rating, "Low");
  assert.strictEqual(get(rows, "Reservoirs").rating, "Not assessed");
  assert.strictEqual(A.fraNeed({ analysis: a, site: site(2), nation: "Scotland", rows }).verdict, "likely");
});

test("Wales Flood Zone 2: FCA likely; climate note says the map includes climate change", () => {
  const a = { nation: "Wales", notes: [], datasets: [ds("nrw", "Wales", "completed", [group("Wales", [row("W-FZ2", "Flood Zone 2", 2, 30)])])] };
  const f = A.fraNeed({ analysis: a, site: site(0.2), nation: "Wales" });
  assert.strictEqual(f.verdict, "likely");
  assert.match(f.headline, /Flood Consequences Assessment/);
  assert.match(A.climateNote("Wales").text, /already includes/);
  assert.match(A.climateNote("England").text, /present-day/);
});

test("Point check only (no site analysis): rating from the centroid zone", () => {
  const res = { nation: "England", fromSite: false, errors: {}, zone: { kind: "england", zone: "FZ2" } };
  const rows = A.riskBySource({ res, nation: "England" });
  assert.strictEqual(get(rows, "Rivers and sea").rating, "Medium");
  assert.match(get(rows, "Rivers and sea").evidence, /Point check only/);
});

test("Northern Ireland: every source not assessed and the answer is unclear", () => {
  const rows = A.riskBySource({ nation: "Northern Ireland" });
  assert.ok(rows.every((r) => r.rating === "Not assessed"));
  assert.strictEqual(A.fraNeed({ nation: "Northern Ireland", rows }).verdict, "unclear");
});

console.log(`\n${passed} tests passed`);
