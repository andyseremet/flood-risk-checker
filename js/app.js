// Wires the modules together: location search, site boundary, flood checks,
// results, data connection tests and the PDF report.
(function (root) {
  "use strict";
  const FRC = root.FRC;
  const { $, esc } = FRC.util;

  const state = {
    current: null,      // last completed point check (postcode search or map click)
    checkSequence: 0,   // stops a slow, older check overwriting a newer one
    siteCheck: null,    // point check at the current site's centroid
    siteCheckSeq: 0,
    site: { features: [], measured: null, warnings: [], errors: [] },
    importNotes: [],    // messages from the last import, kept until the site is cleared
    analysis: null,     // last site-wide flood-zone analysis (cleared when the site changes)
    analysisSeq: 0,
    analysing: false,
    analysisError: null,
    logo: null,         // company logo for the PDF, as a data URL
    building: false,    // a PDF is being built: map clicks wait, the button stays off
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

  // The point check the results and report describe: with a site, the check
  // at that site's centroid; without one, the last postcode search or map
  // click. A click elsewhere is never mixed into a site's report.
  const reportCheck = () => (state.site.features.length ? state.siteCheck : state.current);

  // ---------- Results dashboard ----------
  function renderDashboard() {
    const show = state.site.features.length > 0 || Boolean(state.current);
    $("dashCard").hidden = !show;
    FRC.results.renderDashboard($("dashboard"), {
      site: state.site, current: reportCheck(), analysis: state.analysis,
      siteName: $("siteName").value.trim(), analysing: state.analysing, analysisError: state.analysisError,
    });
  }

  // ---------- Site boundary ----------
  let centroidTimer = null;
  const pdfReady = () => !state.building && (state.site.features.length > 0 || Boolean(state.current));
  function recomputeSite() {
    const raw = FRC.boundaryDraw.getFeatures();
    const v = FRC.boundaryValidation.validate({ type: "FeatureCollection", features: raw }, "The site boundary");
    const site = { auto: FRC.boundaryDraw.isAuto(), features: v.features, warnings: [...state.importNotes, ...v.warnings], errors: v.features.length ? v.errors : [], measured: null };
    if (v.features.length) {
      site.measured = FRC.measurements.measureSite(v.features);
      FRC.boundaryValidation.overlaps(v.features).forEach((o) => site.warnings.push(
        `${site.measured.parcels[o.i].name} and ${site.measured.parcels[o.j].name} overlap by ${FRC.util.fmtNum(o.area, 0)} m². The site area counts that overlap twice.`));
    }
    state.site = site;
    // A point check from somewhere else no longer describes this site, and a
    // check at the old centroid is out of date. The report and dashboard must
    // not mix them with the new boundary, so the centroid is checked again.
    state.siteCheck = null; state.siteCheckSeq++;
    clearTimeout(centroidTimer);
    if (v.features.length) centroidTimer = setTimeout(() => {
      const c = state.site.measured && state.site.measured.centroidWGS;
      if (c && !state.analysing) runCheck({ lat: c[1], lon: c[0], fromSite: true });
    }, 800);
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
    $("pdfBtn").disabled = !pdfReady();
  }

  // ---------- Pin area ----------
  // A dropped pin (map click or postcode) with no boundary of the user's own
  // becomes a 600 m circle, the first site checked. Drawing or importing a
  // boundary replaces it; editing it makes it the user's own boundary.
  const PIN_RADIUS_M = 600;
  function placePin(lat, lon, place) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    state.pinPlace = place || null;
    FRC.boundaryDraw.removeAuto();
    const circle = root.turf.circle([lon, lat], PIN_RADIUS_M / 1000, { steps: 72, units: "kilometers" });
    circle.properties = { name: `${PIN_RADIUS_M} m area around the pin` };
    FRC.map.showPoint(lat, lon, Number($("radius").value), { fit: false });
    FRC.boundaryDraw.addFeatures([circle], { auto: true });
    FRC.boundaryDraw.zoomTo();
    clearTimeout(centroidTimer); // the check below covers the centroid
    runSiteCheck();
  }

  function onSiteChange(kind) {
    // The user's own boundary replaces the pin area.
    if ((kind === "drawn" || kind === "imported") && FRC.boundaryDraw.hasOwn() && FRC.boundaryDraw.layers().some((l) => l._frcAuto)) {
      FRC.boundaryDraw.removeAuto();
    }
    // Once every parcel is gone, messages about an earlier import no longer apply.
    if (kind === "cleared" || !FRC.boundaryDraw.layers().length) { state.importNotes = []; $("importMsg").textContent = ""; $("importMsg").className = "hint"; }
    recomputeSite();
    // Keep the site in the middle of the map after it is drawn, edited or
    // a parcel is removed. With no site left, centre the checked point.
    if (kind === "drawn" || kind === "edited" || kind === "deleted") {
      if (FRC.boundaryDraw.layers().length) FRC.boundaryDraw.zoomTo(); else FRC.map.centre();
    }
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
  // Returns the check's result, or null if a newer check replaced it.
  async function runCheck({ lat, lon, place, fromSite = false }) {
    const seqKey = fromSite ? "siteCheckSeq" : "checkSequence";
    const requestId = ++state[seqKey];
    const stale = () => requestId !== state[seqKey];
    const dist = Number($("radius").value);
    if (fromSite) state.siteCheck = null; else state.current = null;
    $("pdfBtn").disabled = !pdfReady();
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      $("status").textContent = "The selected coordinates are invalid. Please choose another location.";
      return null;
    }
    $("status").textContent = "Checking flood data…";
    FRC.map.showPoint(lat, lon, dist, { fit: !fromSite });

    if (!place) place = await FRC.progress.track(FRC.location.reverseLookup(lat, lon), "Finding the place");
    if (stale()) return null;
    const nation = FRC.location.nationOf(place);
    const res = { lat, lon, place, nation, dist, fromSite, when: new Date(), zone: null, band: null, live: null, gauges: null, liveAt: null, errors: {} };

    const isEng = nation === "England", isWal = nation === "Wales", isSco = nation === "Scotland", unknown = nation === "Unknown";
    const tasks = [];
    const job = (label, p) => tasks.push(FRC.progress.track(p, label).catch(() => {}));
    if (isEng || unknown) job("Flood zone at the point (England)", FRC.ea.zoneAtPoint(lat, lon).then((v) => { if (isEng || v.zone) res.zone = { kind: "england", ...v }; }).catch((e) => { res.errors.zone = e.message; throw e; }));
    if (isWal || unknown) job("Flood zone at the point (Wales)", FRC.nrw.zoneAtPoint(lat, lon).then((v) => { if (isWal || v.hits.length) res.zone = { kind: "wales", ...v }; }).catch((e) => { res.errors.zone = e.message; throw e; }));
    if (isSco || unknown) job("Flood maps at the point (Scotland)", FRC.sepa.floodAtPoint(lat, lon).then((v) => { if (isSco || Object.keys(v.found).length) res.zone = { kind: "scotland", ...v }; }).catch((e) => { res.errors.zone = e.message; throw e; }));
    if (isEng || unknown) {
      job("Long-term risk band", FRC.ea.riskBand(lat, lon).then((v) => (res.band = v)).catch((e) => { res.errors.band = e.message; throw e; }));
      job("Flood warnings", FRC.ea.liveWarnings(lat, lon, dist).then((v) => { res.live = v; res.liveAt = new Date(); }).catch((e) => { res.errors.live = e.message; throw e; }));
      job("River gauges", FRC.ea.nearbyGauges(lat, lon, dist).then((v) => { res.gauges = v; res.liveAt = res.liveAt || new Date(); }).catch((e) => { res.errors.gauges = e.message; throw e; }));
    }
    await Promise.all(tasks);
    // A later map click or postcode search takes precedence over this response.
    if (stale()) return res;

    FRC.map.showGauges(res.gauges);
    if (fromSite) state.siteCheck = res; else state.current = res;
    renderDashboard();
    $("status").textContent = `Checked ${FRC.util.fmtDate(res.when)}.` + (state.site.features.length && !fromSite ? " The results and report cover your site boundary, not this point. Press Clear all to check this point instead." : "");
    $("pdfBtn").disabled = !pdfReady();
    return res;
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
      // The nation comes from this check's own result, so a map click made
      // while it runs cannot change which country's data the site is checked against.
      const pinPlace = state.site.auto ? state.pinPlace : null;
      const res = await runCheck({ lat: m.centroidWGS[1], lon: m.centroidWGS[0], place: pinPlace || undefined, fromSite: true });
      const nation = res ? res.nation : FRC.location.nationOf(await FRC.location.reverseLookup(m.centroidWGS[1], m.centroidWGS[0]));
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
      const place = await FRC.progress.track(FRC.location.lookupPostcode(pc), "Finding the postcode");
      if (!place || !Number.isFinite(place.latitude) || !Number.isFinite(place.longitude)) {
        $("status").textContent = "The postcode service returned no usable location. Check the postcode and try again.";
        return;
      }
      if (FRC.boundaryDraw.hasOwn()) await runCheck({ lat: place.latitude, lon: place.longitude, place });
      else placePin(place.latitude, place.longitude, place);
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
    // The panel is folded away; open it when a service cannot be reached.
    const blocked = ul.querySelectorAll(".pill.bad").length;
    const panel = ul.closest("details");
    if (panel) { panel.open = panel.open || blocked > 0; panel.querySelector("summary").textContent = blocked ? `Data connections: ${blocked} blocked` : "Data connections: all working"; }
  }

  // ---------- Start ----------
  function start() {
    const map = FRC.map.init("map");
    FRC.mapLayers.init(map);
    FRC.boundaryDraw.init(map, { onChange: onSiteChange });

    $("searchForm").addEventListener("submit", (e) => { e.preventDefault(); searchPostcode($("postcode").value); });
    document.querySelectorAll("[data-pc]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); $("postcode").value = a.dataset.pc; searchPostcode(a.dataset.pc); }));
    map.on("click", (e) => {
      if (FRC.boundaryDraw.isBusy() || state.building) return;
      // With a boundary of the user's own, a click is a separate point check.
      if (FRC.boundaryDraw.hasOwn()) runCheck({ lat: e.latlng.lat, lon: e.latlng.lng });
      else placePin(e.latlng.lat, e.latlng.lng);
    });
    // "i" buttons: click shows or hides the help text they point to.
    document.querySelectorAll("button.info, button.info-btn").forEach((b) => b.addEventListener("click", () => {
      const t = $(b.getAttribute("aria-controls"));
      const open = t.hidden;
      // One note at a time.
      document.querySelectorAll("button.info[aria-expanded=true], button.info-btn[aria-expanded=true]").forEach((o) => { if (o !== b) { $(o.getAttribute("aria-controls")).hidden = true; o.setAttribute("aria-expanded", "false"); } });
      t.hidden = !open; b.setAttribute("aria-expanded", String(open));
    }));
    // Help notes stay open only while the user is reading them: moving the
    // map, scrolling, or pressing or tapping anything else closes them.
    const closeHelp = () => document.querySelectorAll("button.info[aria-expanded=true], button.info-btn[aria-expanded=true]").forEach((b) => {
      $(b.getAttribute("aria-controls")).hidden = true; b.setAttribute("aria-expanded", "false");
    });
    document.addEventListener("click", (e) => { if (!e.target.closest("button.info, button.info-btn, .help")) closeHelp(); }, true);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeHelp(); });
    map.on("movestart zoomstart", closeHelp);
    let lastY = root.scrollY;
    root.addEventListener("scroll", () => { if (Math.abs(root.scrollY - lastY) > 40) closeHelp(); lastY = root.scrollY; }, { passive: true });
    $("side").addEventListener("scroll", closeHelp, { passive: true });
    // Postcode search opens from the search button on the map.
    const openSearch = (open) => {
      $("searchPanel").hidden = !open; $("searchToggle").setAttribute("aria-expanded", String(open));
      if (open) $("postcode").focus();
    };
    $("searchToggle").addEventListener("click", () => openSearch($("searchPanel").hidden));
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("searchPanel").hidden) { openSearch(false); $("searchToggle").focus(); } });
    $("radius").addEventListener("change", () => {
      [state.current, state.siteCheck].forEach((c) => { if (c) runCheck({ lat: c.lat, lon: c.lon, place: c.place, fromSite: c.fromSite }); });
    });

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
      const btn = $("pdfBtn");
      if (state.building) return;
      state.building = true; btn.disabled = true; btn.textContent = "Building PDF…";
      try {
        await FRC.progress.track(FRC.pdfReport.build(reportCheck(), state.site, state.analysis, {
          company: $("company").value.trim(), logo: state.logo,
          siteName: $("siteName").value.trim(), ref: $("ref").value.trim(), analyst: $("analyst").value.trim(), checkedBy: $("checkedBy").value.trim(), version: $("version").value.trim(), notes: $("notes").value.trim(),
          sections: { location: $("o-location").checked, site: $("o-site").checked, zone: $("o-zone").checked, intersect: $("o-intersect").checked, other: $("o-other").checked, live: $("o-live").checked, maps: $("o-maps").checked },
        }), "Building the PDF report");
      } catch (e) { $("status").textContent = "Could not build the PDF: " + e.message; }
      state.building = false; btn.disabled = !pdfReady(); btn.textContent = "Download PDF report";
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
