// Wires the modules together: location search, site boundary, flood checks,
// results, data connection tests and the PDF report.
(function (root) {
  "use strict";
  const FRC = root.FRC;
  const { $, esc } = FRC.util;

  const state = {
    current: null,      // last completed flood check
    checkSequence: 0,   // stops a slow, older check overwriting a newer one
    site: { features: [], measured: null, warnings: [], errors: [] },
    importNotes: [],    // messages from the last import, kept until the site is cleared
    analysis: null,     // last site-wide flood-zone analysis (cleared when the site changes)
    analysisSeq: 0,
    analysing: false,
    analysisError: null,
    logo: null,         // company logo for the PDF, as a data URL
  };

  // Company name and logo are remembered in this browser only. Storage can be
  // unavailable (private windows), so every access is guarded.
  const store = {
    get(k) { try { return localStorage.getItem("frc." + k); } catch { return null; } },
    set(k, v) { try { if (v == null || v === "") localStorage.removeItem("frc." + k); else localStorage.setItem("frc." + k, v); } catch { /* not saved */ } },
  };
  function setLogo(dataUrl, label) {
    state.logo = dataUrl || null;
    $("logoClear").hidden = !state.logo;
    $("logoMsg").textContent = state.logo ? label || "Logo added." : "";
  }
  FRC.state = state;

  // ---------- Results dashboard ----------
  function renderDashboard() {
    const show = state.site.features.length > 0 || Boolean(state.current);
    $("dashCard").hidden = !show;
    FRC.results.renderDashboard($("dashboard"), {
      site: state.site, current: state.current, analysis: state.analysis,
      siteName: $("siteName").value.trim(), analysing: state.analysing, analysisError: state.analysisError,
    });
  }

  // ---------- Site boundary ----------
  function recomputeSite() {
    const raw = FRC.boundaryDraw.getFeatures();
    const v = FRC.boundaryValidation.validate({ type: "FeatureCollection", features: raw }, "The site boundary");
    const site = { features: v.features, warnings: [...state.importNotes, ...v.warnings], errors: v.features.length ? v.errors : [], measured: null };
    if (v.features.length) {
      site.measured = FRC.measurements.measureSite(v.features);
      FRC.boundaryValidation.overlaps(v.features).forEach((o) => site.warnings.push(
        `${site.measured.parcels[o.i].name} and ${site.measured.parcels[o.j].name} overlap by ${FRC.util.fmtNum(o.area, 0)} m². The site area counts that overlap twice.`));
    }
    state.site = site;
    // Any change to the boundary makes the previous analysis out of date.
    state.analysisSeq++;
    state.analysis = null;
    state.analysing = false;
    state.analysisError = null;
    FRC.map.showAnalysis(null);
    FRC.results.renderSite($("siteInfo"), site);
    renderDashboard();
    const has = site.features.length > 0;
    $("exportBtn").disabled = !has;
    $("clearBtn").disabled = !has;
    $("siteCheckBtn").disabled = !has;
    $("pdfBtn").disabled = !(has || state.current);
  }

  function onSiteChange(kind) {
    // Once every parcel is gone, messages about an earlier import no longer apply.
    if (kind === "cleared" || !FRC.boundaryDraw.layers().length) { state.importNotes = []; $("importMsg").textContent = ""; $("importMsg").className = "hint"; }
    recomputeSite();
  }

  async function importFile(file) {
    const msg = $("importMsg");
    msg.className = "hint"; msg.textContent = "Reading " + file.name + "…";
    try {
      const parsed = await FRC.boundaryImport.readFile(file);
      const v = FRC.boundaryValidation.validate(parsed, file.name);
      if (!v.features.length) throw new Error(v.errors.join(" ") || "No usable polygons were found.");
      state.importNotes = [...v.warnings, ...v.errors.map((e) => "Skipped: " + e)];
      const layers = FRC.boundaryDraw.addFeatures(v.features);
      FRC.boundaryDraw.zoomTo();
      msg.className = "hint";
      msg.textContent = `Imported ${layers.length} parcel${layers.length > 1 ? "s" : ""} from ${file.name}.`;
    } catch (e) {
      msg.className = "msg bad";
      msg.textContent = "Could not import " + file.name + ". " + e.message;
    }
  }

  // ---------- Flood checks ----------
  async function runCheck({ lat, lon, place, fromSite = false }) {
    const requestId = ++state.checkSequence;
    const dist = Number($("radius").value);
    state.current = null;
    $("pdfBtn").disabled = !state.site.features.length;
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      $("status").textContent = "The selected coordinates are invalid. Please choose another location.";
      return;
    }
    $("status").textContent = "Checking flood data…";
    FRC.map.showPoint(lat, lon, dist, { fit: !fromSite });

    if (!place) place = await FRC.location.reverseLookup(lat, lon);
    if (requestId !== state.checkSequence) return;
    const nation = (place && place.country) || "Unknown";
    const res = { lat, lon, place, nation, dist, fromSite, when: new Date(), zone: null, band: null, live: null, gauges: null, liveAt: null, errors: {} };

    const isEng = nation === "England", isWal = nation === "Wales", isSco = nation === "Scotland", unknown = nation === "Unknown";
    const tasks = [];
    if (isEng || unknown) tasks.push(FRC.ea.zoneAtPoint(lat, lon).then((v) => { if (isEng || v.zone) res.zone = { kind: "england", ...v }; }).catch((e) => (res.errors.zone = e.message)));
    if (isWal || unknown) tasks.push(FRC.nrw.zoneAtPoint(lat, lon).then((v) => { if (isWal || v.hits.length) res.zone = { kind: "wales", ...v }; }).catch((e) => (res.errors.zone = e.message)));
    if (isSco || unknown) tasks.push(FRC.sepa.floodAtPoint(lat, lon).then((v) => { if (isSco || Object.keys(v.found).length) res.zone = { kind: "scotland", ...v }; }).catch((e) => (res.errors.zone = e.message)));
    if (isEng || unknown) {
      tasks.push(FRC.ea.riskBand(lat, lon).then((v) => (res.band = v)).catch((e) => (res.errors.band = e.message)));
      tasks.push(FRC.ea.liveWarnings(lat, lon, dist).then((v) => { res.live = v; res.liveAt = new Date(); }).catch((e) => (res.errors.live = e.message)));
      tasks.push(FRC.ea.nearbyGauges(lat, lon, dist).then((v) => { res.gauges = v; res.liveAt = res.liveAt || new Date(); }).catch((e) => (res.errors.gauges = e.message)));
    }
    await Promise.all(tasks);
    // A later map click or postcode search takes precedence over this response.
    if (requestId !== state.checkSequence) return;

    FRC.map.showGauges(res.gauges);
    state.current = res;
    renderDashboard();
    $("status").textContent = `Checked ${FRC.util.fmtDate(res.when)}.`;
    $("pdfBtn").disabled = false;
  }

  // Point checks at the centroid, then the site-wide flood-zone intersection.
  async function runSiteCheck() {
    const m = state.site.measured;
    if (!m || !m.centroidWGS) return;
    const seq = ++state.analysisSeq;
    const features = state.site.features;
    state.analysing = true;
    state.analysisError = null;
    renderDashboard();
    $("siteCheckBtn").disabled = true;
    try {
      await runCheck({ lat: m.centroidWGS[1], lon: m.centroidWGS[0], fromSite: true });
      const nation = state.current ? state.current.nation : "Unknown";
      const a = await FRC.floodAnalysis.analyseSite(features, nation);
      if (seq !== state.analysisSeq) return; // the boundary changed while we waited
      state.analysis = a;
      state.analysing = false;
      renderDashboard();
      FRC.map.showAnalysis(a);
      $("dashCard").scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (e) {
      if (seq === state.analysisSeq) { state.analysing = false; state.analysisError = e.message; renderDashboard(); }
    } finally {
      $("siteCheckBtn").disabled = !state.site.features.length;
    }
  }

  async function searchPostcode(pc) {
    pc = String(pc || "").trim();
    if (!pc) return;
    if (!FRC.location.isPostcode(pc)) { $("status").textContent = "That doesn't look like a UK postcode. Check it, for example YO1 7HH."; return; }
    $("status").textContent = "Looking up postcode…";
    try {
      const place = await FRC.location.lookupPostcode(pc);
      if (!place || !Number.isFinite(place.latitude) || !Number.isFinite(place.longitude)) {
        $("status").textContent = "The postcode service returned no usable location. Check the postcode and try again.";
        return;
      }
      await runCheck({ lat: place.latitude, lon: place.longitude, place });
    } catch (e) {
      $("status").textContent = /404/.test(e.message) ? "That postcode was not found. Check it and try again." : "Could not reach the postcode service. Try again, or click the map instead.";
    }
  }

  // ---------- Connection test ----------
  const CHECKS = [
    ["Postcode lookup (postcodes.io)", () => FRC.util.getJSON(`${FRC.config.api.postcode}/postcodes/SW1A1AA`)],
    ["Live warnings (Environment Agency)", () => FRC.util.getJSON(`${FRC.config.api.eaFlood}/id/floods?_limit=1`)],
    ["Flood zones (Environment Agency)", () => FRC.util.getJSON(`${FRC.config.api.eaZones}?f=json&limit=1`)],
    ["Risk band (Environment Agency)", () => FRC.ea.riskBand(53.959, -1.081)],
    ["Surface water (Environment Agency)", () => FRC.ea.surfaceWaterAtPoint(53.959, -1.081)],
    ["Reservoir extents (Environment Agency)", () => FRC.util.getJSON(`${FRC.config.api.eaReservoir}?f=json&limit=1`)],
    ["Recorded floods (Environment Agency)", () => FRC.util.getJSON(`${FRC.config.api.eaRecorded}?f=json&limit=1`)],
    ["Flood zones (Natural Resources Wales)", () => FRC.nrw.zoneAtPoint(51.62, -3.94)],
    ["Flood maps (SEPA)", () => FRC.sepa.floodAtPoint(56.396, -3.437)],
  ];
  async function testConnections() {
    const ul = $("checks");
    ul.innerHTML = CHECKS.map((c, i) => `<li><span>${esc(c[0])}</span><span class="pill neutral" id="chk${i}">Testing</span></li>`).join("");
    await Promise.all(CHECKS.map(async (c, i) => {
      const el = $("chk" + i);
      try { await c[1](); el.className = "pill info"; el.textContent = "Working"; }
      catch (e) { el.className = "pill bad"; el.textContent = "Blocked"; el.title = e.message; }
    }));
  }

  // ---------- Start ----------
  function start() {
    const map = FRC.map.init("map");
    FRC.mapLayers.init(map);
    FRC.boundaryDraw.init(map, { onChange: onSiteChange });

    $("searchForm").addEventListener("submit", (e) => { e.preventDefault(); searchPostcode($("postcode").value); });
    document.querySelectorAll("[data-pc]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); $("postcode").value = a.dataset.pc; searchPostcode(a.dataset.pc); }));
    map.on("click", (e) => { if (!FRC.boundaryDraw.isBusy()) runCheck({ lat: e.latlng.lat, lon: e.latlng.lng }); });
    $("radius").addEventListener("change", () => { const c = state.current; if (c) runCheck({ lat: c.lat, lon: c.lon, place: c.place, fromSite: c.fromSite }); });

    $("drawBtn").addEventListener("click", () => FRC.boundaryDraw.startPolygon());
    $("clearBtn").addEventListener("click", () => FRC.boundaryDraw.clear());
    $("importInput").addEventListener("change", (e) => { const f = e.target.files[0]; if (f) importFile(f); e.target.value = ""; });
    $("exportBtn").addEventListener("click", () => FRC.boundaryExport.download(state.site.features, state.site.measured, $("siteName").value.trim()));
    $("siteCheckBtn").addEventListener("click", runSiteCheck);
    $("siteName").addEventListener("input", renderDashboard);
    $("siteInfo").addEventListener("click", (e) => {
      const z = e.target.closest("[data-zoom]"), r = e.target.closest("[data-remove]");
      const layers = FRC.boundaryDraw.layers();
      if (z) FRC.boundaryDraw.zoomTo(layers[Number(z.dataset.zoom)]);
      if (r && layers[Number(r.dataset.remove)]) FRC.boundaryDraw.removeLayer(layers[Number(r.dataset.remove)]);
    });

    $("pdfBtn").addEventListener("click", async () => {
      const btn = $("pdfBtn"); btn.disabled = true; btn.textContent = "Building PDF…";
      try {
        await FRC.pdfReport.build(state.current, state.site, state.analysis, {
          company: $("company").value.trim(), logo: state.logo,
          siteName: $("siteName").value.trim(), ref: $("ref").value.trim(), analyst: $("analyst").value.trim(), notes: $("notes").value.trim(),
          sections: { location: $("o-location").checked, site: $("o-site").checked, zone: $("o-zone").checked, intersect: $("o-intersect").checked, other: $("o-other").checked, live: $("o-live").checked, maps: $("o-maps").checked },
        });
      } catch (e) { $("status").textContent = "Could not build the PDF: " + e.message; }
      btn.disabled = false; btn.textContent = "Download PDF report";
    });
    $("checkBtn").addEventListener("click", testConnections);

    $("company").value = store.get("company") || "";
    $("company").addEventListener("input", () => store.set("company", $("company").value.trim()));
    if (store.get("logo")) setLogo(store.get("logo"), "Saved logo will be used.");
    $("logoInput").addEventListener("change", (e) => {
      const f = e.target.files[0]; e.target.value = "";
      if (!f) return;
      if (!/^image\/(png|jpeg)$/.test(f.type)) { $("logoMsg").textContent = "Use a PNG or JPG image."; return; }
      if (f.size > 500 * 1024) { $("logoMsg").textContent = "That image is over 500 KB. Use a smaller one."; return; }
      const r = new FileReader();
      r.onload = () => { setLogo(r.result, "Logo added: " + f.name); store.set("logo", r.result); };
      r.readAsDataURL(f);
    });
    $("logoClear").addEventListener("click", () => { setLogo(null); store.set("logo", null); });

    recomputeSite();
    testConnections();
  }

  FRC.app = { start, runCheck, runSiteCheck, searchPostcode, importFile, recomputeSite };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})(window);
