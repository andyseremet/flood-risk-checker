// Phase 9 test run against the live services, from the user's browser.
// Runs the spec's test cases (real sites, imports, failures), checks each
// result against fixed rules and expected values, and produces a report the
// user can copy and send back.
(function (root) {
  "use strict";
  const FRC = root.FRC;
  const { $, esc, fmtNum } = FRC.util;
  const P = FRC.projections;

  // A square site of `size` metres centred on a WGS84 point, built in BNG.
  function square(lat, lon, size, hole = 0) {
    const [e, n] = P.toBNG([lon, lat]), h = size / 2;
    const ring = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
    const rings = [ring(e - h, n - h, e + h, n + h)];
    if (hole) rings.push(ring(e - hole / 2, n - hole / 2, e + hole / 2, n + hole / 2).reverse());
    return { type: "Feature", properties: {}, geometry: P.geometryToWGS84({ type: "Polygon", coordinates: rings }) };
  }

  // Real sites. `expect` holds soft expectations: a miss is flagged "Check",
  // not "Fail", because the published data can change.
  const SITES = [
    { id: "york", nation: "England", title: "England, site crossing several classes: York city centre by the River Ouse (300 m square)",
      features: () => [square(53.9572, -1.0812, 300)], expect: { ea: ["FZ3"] } },
    { id: "downs", nation: "England", title: "England, site outside the flood zones: Dunstable Downs chalk ridge (200 m square)",
      features: () => [square(51.8645, -0.5435, 200)], expect: { eaNone: true } },
    { id: "london", nation: "England", title: "England, large site with complex polygons: Thames at Blackfriars (1 km square)",
      features: () => [square(51.5095, -0.1040, 1000)], expect: {} },
    { id: "multipart", nation: "England", title: "England, two-parcel site: York riverside and York Minster (100 m squares)",
      features: () => [square(53.9572, -1.0812, 100), square(53.9623, -1.0819, 100)], expect: { parcels: 2 } },
    { id: "hole", nation: "England", title: "England, site with a hole: York riverside, 300 m square with a 100 m hole",
      features: () => [square(53.9572, -1.0812, 300, 100)], expect: { area: 80000 } },
    { id: "swansea", nation: "Wales", title: "Wales: Swansea by the River Tawe (300 m square)",
      features: () => [square(51.6255, -3.9370, 300)], expect: { nrw: true } },
    { id: "perth", nation: "Scotland", title: "Scotland: Perth North Inch by the River Tay (300 m square)",
      features: () => [square(56.4040, -3.4300, 300)], expect: { sepa: ["River-High", "River-Medium", "River-Low"] } },
  ];

  // Spec test fixtures with known geometry (tests/fixtures).
  const FIXTURES = [
    { file: "square-100m-bng.geojson", title: "GeoJSON in British National Grid (coordinate system conversion)", area: 10000, perimeter: 400 },
    { file: "square-with-hole.geojson", title: "GeoJSON polygon with a hole", area: 37500 },
    { file: "multipart.geojson", title: "GeoJSON multipart polygon", area: 20000 },
    { file: "two-parcels.kml", title: "KML import (two parcels)", area: 12500, parcels: 2 },
    { file: "site-shapefile.zip", title: "Zipped Shapefile import", area: 22500 },
    { file: "bowtie-invalid.geojson", title: "Invalid self-crossing polygon is rejected", reject: /crosses itself/ },
    { file: "empty.geojson", title: "Empty file is rejected", reject: /no geometry/ },
  ];

  const results = [];
  let running = false;
  const add = (group, title, verdict, detail, data) => {
    results.push({ group, title, verdict, detail, data });
    render();
  };
  function render() {
    const counts = { Pass: 0, Check: 0, Fail: 0 };
    results.forEach((r) => { counts[r.verdict] = (counts[r.verdict] || 0) + 1; });
    $("summary").textContent = results.length ? `${counts.Pass} passed, ${counts.Check} to check, ${counts.Fail} failed` : "";
    const cls = { Pass: "info", Check: "warn", Fail: "bad" };
    $("out").innerHTML = results.map((r) => `<div class="result"><div class="title"><span>${esc(r.group)}: ${esc(r.title)}</span><span class="pill ${cls[r.verdict]}">${esc(r.verdict)}</span></div>${r.detail.map((d) => `<p class="hint">${esc(d)}</p>`).join("")}</div>`).join("");
    $("report").value = reportText();
  }
  function reportText() {
    const lines = [`Flood Risk Checker test run, ${new Date().toISOString()}, version ${root.FRC_VERSION || "?"}, ${navigator.userAgent}`,
      running ? "STILL RUNNING: this report is incomplete. Wait for 'Finished' and copy again." : "Run complete.",
      `Measurements run ${FRC.compute && FRC.compute.usingWorker ? "in a background worker" : "on the page"}.`, $("progress").textContent, $("summary").textContent, ""];
    results.forEach((r) => {
      lines.push(`[${r.verdict}] ${r.group}: ${r.title}`);
      r.detail.forEach((d) => lines.push("    " + d));
      if (r.data) lines.push("    data: " + JSON.stringify(r.data).slice(0, 1500));
    });
    return lines.join("\n");
  }

  const timed = async (fn) => { const t = performance.now(); const v = await fn(); return [v, Math.round(performance.now() - t)]; };
  const keysOf = (f) => Object.keys((f && f.properties) || {});

  // ---------- 1. Connections ----------
  async function connections() {
    const A = FRC.config.api;
    const list = [
      ["Postcode lookup", () => FRC.util.getJSON(`${A.postcode}/postcodes/YO17HH`)],
      ["EA flood zones (OGC API)", () => FRC.util.getJSON(`${A.eaZones}?f=json&limit=1`)],
      ["EA risk band (WMS)", () => FRC.ea.riskBand(53.9572, -1.0812)],
      ["EA surface water (WMS)", () => FRC.ea.surfaceWaterAtPoint(53.9572, -1.0812)],
      ["EA reservoir extents (OGC API)", () => FRC.util.getJSON(`${A.eaReservoir}?f=json&limit=1`)],
      ["EA recorded floods (OGC API)", () => FRC.util.getJSON(`${A.eaRecorded}?f=json&limit=1`)],
      ["EA live warnings", () => FRC.util.getJSON(`${A.eaFlood}/id/floods?_limit=1`)],
      ["NRW flood zones (WFS)", () => FRC.nrw.zoneAtPoint(51.6255, -3.9370)],
      ["SEPA flood maps", () => FRC.sepa.floodAtPoint(56.4040, -3.4300)],
    ];
    for (const [name, fn] of list) {
      try { const [, ms] = await timed(fn); add("Connection", name, "Pass", [`Reached in ${ms} ms.`]); }
      catch (e) { add("Connection", name, "Fail", ["Could not reach the service: " + e.message]); }
    }
  }

  // ---------- 2. What the live data looks like ----------
  async function discovery() {
    const york = FRC.floodAnalysis.siteBox([square(53.9572, -1.0812, 300).geometry]);
    const swansea = FRC.floodAnalysis.siteBox([square(51.6255, -3.9370, 300).geometry]);
    const probe = async (title, fn, judge) => {
      try { const v = await fn(); const [verdict, detail, data] = judge(v); add("Live data", title, verdict, detail, data); }
      catch (e) { add("Live data", title, "Fail", ["Request failed: " + e.message]); }
    };
    // A point known to lie inside a mapped Flood Zone 3 polygon near York, so
    // the risk band check has to find something there. (The site centre is
    // outside the mapped zones, so an empty answer there proves nothing.)
    let fz3 = null;
    await probe("EA flood zone values near York", () => FRC.ea.zonesInBox(york), (r) => {
      const zones = [...new Set(r.features.map((f) => f.properties && f.properties.flood_zone))];
      const srcs = [...new Set(r.features.map((f) => f.properties && f.properties.flood_source))];
      for (const f of r.features) {
        if (!f.properties || f.properties.flood_zone !== "FZ3" || !f.geometry) continue;
        try {
          const part = turf.bboxClip({ type: "Feature", properties: {}, geometry: f.geometry }, york);
          const c = turf.pointOnFeature(part).geometry.coordinates;
          if (FRC.util.inGeometry(c[0], c[1], f.geometry)) { fz3 = { lon: c[0], lat: c[1] }; break; }
        } catch { /* try the next polygon */ }
      }
      return [zones.some((z) => z === "FZ2" || z === "FZ3") ? "Pass" : "Check", [`${r.features.length} polygons. flood_zone values: ${zones.join(", ") || "none"}. flood_source values: ${srcs.join(", ") || "none"}.`, fz3 ? `Point inside Flood Zone 3 used for the band checks: ${fz3.lat.toFixed(5)}, ${fz3.lon.toFixed(5)}.` : "No Flood Zone 3 point found for the band checks."], { keys: keysOf(r.features[0]), zones, srcs, fz3 }];
    });
    await probe("NRW flood zone field (Swansea)", () => FRC.nrw.zonesInBox(swansea), (r) => {
      const items = FRC.normalise.nrw(r.features);
      const classes = [...new Set(items.map((i) => i.key))];
      const sample = r.features.slice(0, 3).map((f) => f.properties);
      const ok = classes.some((k) => k === "W-FZ2" || k === "W-FZ3");
      return [ok ? "Pass" : "Check", [`${r.features.length} polygons. Classes read: ${classes.join(", ") || "none"}.`, ok ? "The app can read the Wales flood zone." : "The app could not read Zone 2 or 3 from these properties. Send this report so the field name can be fixed."], { keys: keysOf(r.features[0]), sample }];
    });
    const pt = fz3 || { lat: 53.9572, lon: -1.0812 };
    const where = fz3 ? "inside Flood Zone 3, York" : "York site centre";
    const bandDetail = (r) => [`Band read: ${r.band || "none at this point"}.`, r.raw ? `Properties: ${Object.keys(r.raw).join(", ")} (found using ${r.format}).` : "No feature returned at this point."];
    await probe(`EA risk band attribute (${where})`, () => FRC.ea.riskBand(pt.lat, pt.lon), (r) => [
      r.band && r.band !== "See details" ? "Pass" : fz3 ? "Fail" : "Check",
      [...bandDetail(r), ...(!r.band && fz3 ? ["Flood Zone 3 areas almost always carry a river and sea risk band, so the point query is probably not working."] : [])], { raw: r.raw, tried: r.tried }]);
    await probe(`EA surface water band attribute (${where})`, () => FRC.ea.surfaceWaterAtPoint(pt.lat, pt.lon), (r) => [
      r.band && !/not stated/.test(r.band) ? "Pass" : "Check",
      [...bandDetail(r), ...(!r.band ? ["Surface water risk is not mapped everywhere, so an empty answer here may be correct."] : [])], { raw: r.raw, tried: r.tried }]);
    await probe("EA reservoir extent fields (York)", () => FRC.ea.reservoirInBox(york), (r) => [
      r.features.length ? (keysOf(r.features[0]).includes("reservoir") ? "Pass" : "Check") : "Check",
      [`${r.features.length} extents. Fields: ${keysOf(r.features[0]).join(", ") || "none returned"}.`], { names: r.features.slice(0, 5).map((f) => f.properties && f.properties.reservoir) }]);
    await probe("EA recorded flood fields (York)", () => FRC.ea.recordedInBox(york), (r) => [
      r.features.length ? (keysOf(r.features[0]).includes("name") ? "Pass" : "Check") : "Check",
      [`${r.features.length} outlines. Fields: ${keysOf(r.features[0]).join(", ") || "none returned"}.`], { names: r.features.slice(0, 5).map((f) => f.properties && f.properties.name) }]);
  }

  // ---------- 3. Site analysis on real sites ----------
  function checkAnalysis(site, a, ms) {
    const detail = [`Completed in ${fmtNum(ms / 1000, 1)} s.`], problems = [], checks = [];
    const data = {};
    a.datasets.forEach((d) => {
      const s = `${d.name.split(" (")[0]}: ${d.statusText}`;
      if (d.status === "notAssessed") return;
      if (d.status === "error") problems.push(`${s}. ${d.error}`);
      else if (d.status === "unavailable") problems.push(`${s}. ${d.error}`);
      const groups = (d.groups || []).map((g) => {
        const total = g.rows.reduce((t, r) => t + r.percent, 0) + g.remainingPercent;
        if (Math.abs(total - 100) > 0.5) problems.push(`${d.id} ${g.group}: percentages add up to ${total.toFixed(2)}%, not 100%.`);
        if (g.rows.some((r) => /flood zone 1\b/i.test(r.label))) problems.push(`${d.id}: a class is labelled Flood Zone 1.`);
        return `${g.group} [${g.rows.map((r) => `${r.key} ${r.percent.toFixed(1)}%`).join(", ") || "none"}; no polygon ${g.remainingPercent.toFixed(1)}%]`;
      });
      detail.push(s + (d.summary ? `. ${d.summary}` : "") + (groups.length ? ". " + groups.join(" ") : ""));
      if (d.status === "partial") (d.notes || []).slice(0, 2).forEach((n) => detail.push("    Note: " + n));
      data[d.id] = { status: d.status, est: Boolean(d.estimated), rows: (d.groups || []).flatMap((g) => g.rows.map((r) => [r.key, +r.percent.toFixed(2)])) };
    });
    const e = site.expect, byId = (id) => a.datasets.find((d) => d.id === id);
    const keys = (id) => (byId(id) && byId(id).groups || []).flatMap((g) => g.rows.map((r) => r.key));
    if (e.ea) checks.push([e.ea.every((k) => keys("ea").includes(k)), `Expected ${e.ea.join(", ")} in the EA analysis.`]);
    if (e.eaNone) checks.push([keys("ea").length === 0 && byId("ea").status === "none", "Expected no Flood Zone 2 or 3 polygon and the status 'No mapped feature identified'."]);
    if (e.nrw) checks.push([keys("nrw").some((k) => k === "W-FZ2" || k === "W-FZ3"), "Expected Wales Zone 2 or 3 to be read."]);
    if (e.sepa) checks.push([e.sepa.some((k) => keys("sepa").includes(k)), "Expected Scottish river likelihood bands."]);
    if (e.area) { const got = FRC.measurements.measureSite(site.features()).area; checks.push([Math.abs(got - e.area) < 2, `Expected site area ${fmtNum(e.area)} m², got ${fmtNum(got)} m².`]); }
    if (e.parcels) checks.push([site.features().length === e.parcels, `Expected ${e.parcels} parcels.`]);
    if (ms > 60000) checks.push([false, "Took over a minute."]);
    const missed = checks.filter(([ok]) => !ok).map(([, t]) => "Not as expected: " + t);
    return [problems.length ? "Fail" : missed.length ? "Check" : "Pass", [...problems, ...missed, ...detail], data];
  }

  // Each site gets up to 3 minutes. The progress line names the datasets
  // still running, so a slow one shows up in the report.
  const SITE_LIMIT = 180000;
  async function sites() {
    for (const [i, site] of SITES.entries()) {
      const label = `Analysing site ${i + 1} of ${SITES.length}: ${site.title.split(": ").pop()}`;
      const started = performance.now();
      let waiting = [];
      const show = () => { $("progress").textContent = `${label}. ${Math.round((performance.now() - started) / 1000)} s${waiting.length ? ", waiting for " + waiting.join(", ") : ""}…`; render(); };
      show();
      const tick = setInterval(show, 5000);
      await new Promise((r) => setTimeout(r, 0));
      try {
        let timer;
        const limit = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`no result after ${SITE_LIMIT / 60000} minutes; still waiting for ${waiting.join(", ") || "unknown"}`)), SITE_LIMIT); });
        const [a, ms] = await timed(() => Promise.race([FRC.floodAnalysis.analyseSite(site.features(), site.nation, (left) => { waiting = left; show(); }), limit]).finally(() => clearTimeout(timer)));
        const [verdict, detail, data] = checkAnalysis(site, a, ms);
        add("Site analysis", site.title, verdict, detail, data);
      } catch (e) { add("Site analysis", site.title, "Fail", ["The analysis stopped: " + e.message]); }
      finally { clearInterval(tick); }
    }
  }

  // ---------- 4. Imports, export and validation ----------
  async function imports() {
    for (const fx of FIXTURES) {
      try {
        const res = await fetch("tests/fixtures/" + fx.file);
        if (!res.ok) throw new Error("fixture not found (HTTP " + res.status + ")");
        const file = new File([await res.blob()], fx.file);
        const parsed = await FRC.boundaryImport.readFile(file);
        const v = FRC.boundaryValidation.validate(parsed, fx.file);
        if (fx.reject) {
          const ok = !v.features.length && v.errors.some((e) => fx.reject.test(e));
          add("Import", fx.title, ok ? "Pass" : "Fail", [ok ? "Rejected with: " + v.errors.join(" ") : "Was not rejected as expected. Errors: " + (v.errors.join(" ") || "none")]);
          continue;
        }
        const m = FRC.measurements.measureSite(v.features);
        const ok = Math.abs(m.area - fx.area) < 2 && (!fx.parcels || m.parcels.length === fx.parcels) && (!fx.perimeter || Math.abs(m.perimeter - fx.perimeter) < 0.5);
        add("Import", fx.title, ok ? "Pass" : "Fail", [`Area ${fmtNum(m.area, 1)} m² (expected ${fmtNum(fx.area)}), perimeter ${fmtNum(m.perimeter, 1)} m, ${m.parcels.length} parcel(s).`, ...v.errors, ...v.warnings]);
      } catch (e) { add("Import", fx.title, "Fail", [e.message]); }
    }
    // Export then re-import gives the same area.
    try {
      const feats = SITES[3].features();
      const gj = FRC.boundaryExport.build(feats, FRC.measurements.measureSite(feats), "Round trip");
      const back = FRC.boundaryValidation.validate(FRC.boundaryImport.parseGeoJSON(JSON.stringify(gj)), "export");
      const a0 = FRC.measurements.measureSite(feats).area, a1 = FRC.measurements.measureSite(back.features).area;
      add("Import", "GeoJSON export and re-import keep the same area", Math.abs(a0 - a1) < 0.5 ? "Pass" : "Fail", [`Before ${fmtNum(a0, 1)} m², after ${fmtNum(a1, 1)} m².`]);
    } catch (e) { add("Import", "GeoJSON export and re-import", "Fail", [e.message]); }
  }

  // ---------- 5. Service failure ----------
  async function failures() {
    const A = FRC.config.api, saved = A.eaZones;
    A.eaZones = "https://flood-risk-checker-test.invalid/items";
    try {
      const a = await FRC.floodAnalysis.analyseSite(SITES[0].features(), "England");
      const d = a.datasets.find((x) => x.id === "ea");
      add("Failure handling", "An unreachable flood zone service is reported, not treated as 'no flood zone'", d.status === "unavailable" ? "Pass" : "Fail", [`Status: ${d.statusText}. ${d.error || ""}`]);
    } catch (e) { add("Failure handling", "Unreachable service", "Fail", ["The analysis stopped instead of reporting the service: " + e.message]); }
    finally { A.eaZones = saved; }
    try {
      await FRC.util.getJSON(`${FRC.config.api.eaZones}?f=json&limit=500&bbox=-6,50,2,56`, 1);
      add("Failure handling", "A request that takes too long is stopped", "Check", ["The request finished within 1 ms, so the timeout could not be tested."]);
    } catch (e) { add("Failure handling", "A request that takes too long is stopped", /timed out/.test(e.message) ? "Pass" : "Check", ["Result: " + e.message]); }
  }

  async function run() {
    results.length = 0; render();
    const btn = $("runBtn"); btn.disabled = true;
    running = true; $("copyBtn").textContent = "Copy report so far (still running)";
    const steps = [["Checking connections…", connections], ["Reading live data…", discovery], ["Analysing real sites (this can take a minute)…", sites], ["Testing imports…", imports], ["Testing failures…", failures]];
    for (const [msg, fn] of steps) { $("progress").textContent = msg; render(); await fn(); }
    running = false;
    $("progress").textContent = "Finished. Copy the report below and send it back.";
    render();
    btn.disabled = false; $("copyBtn").textContent = "Copy report";
  }

  FRC.diagnostics = { run, SITES, FIXTURES, square };
  document.addEventListener("DOMContentLoaded", () => {
    $("runBtn").addEventListener("click", run);
    $("copyBtn").addEventListener("click", async () => {
      try { await navigator.clipboard.writeText($("report").value); $("copyBtn").textContent = "Copied"; }
      catch { $("report").select(); $("copyBtn").textContent = "Press Ctrl+C to copy"; }
      setTimeout(() => ($("copyBtn").textContent = running ? "Copy report so far (still running)" : "Copy report"), 2500);
    });
  });
})(window);
