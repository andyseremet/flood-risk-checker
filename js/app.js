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
    updateRetry();
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
    // not mix them with the new boundary. Nothing is fetched until Check is pressed.
    state.siteCheck = null; state.siteCheckSeq++;
    clearTimeout(centroidTimer);
    if (v.features.length && !state.analysing) setStatus(site.auto ? "Pin placed. Press Check to start the flood checks." : "Site boundary ready. Press Check to start the flood checks.");
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
    // The checks start only when Check is pressed.
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
      setStatus("The selected coordinates are invalid. Please choose another location.");
      return null;
    }
    setStatus("Checking flood data…");
    precheck();
    FRC.map.showPoint(lat, lon, dist, { fit: !fromSite });

    if (!place) place = await FRC.progress.track(FRC.location.reverseLookup(lat, lon), "Finding the place");
    if (stale()) return null;
    const nation = FRC.location.nationOf(place);
    const res = { lat, lon, place, nation, dist, fromSite, when: new Date(), zone: null, band: null, live: null, gauges: null, liveAt: null, errors: {}, errorUrls: {} };

    await Promise.all(pointJobs(res).map((t) => FRC.progress.track(t.run(), t.label).catch(() => {})));
    // A later map click or postcode search takes precedence over this response.
    if (stale()) return res;

    FRC.map.showGauges(res.gauges);
    if (fromSite) state.siteCheck = res; else state.current = res;
    renderDashboard();
    setStatus(`Checked ${FRC.util.fmtDate(res.when)}.` + (state.site.features.length && !fromSite ? " The results and report cover your site boundary, not this point. Press Clear to check this point instead." : ""));
    $("pdfBtn").disabled = !pdfReady();
    return res;
  }

  // The point checks for one result. Each job writes its answer, or its error
  // under its key, into res, so a failed one can be run again on its own.
  function pointJobs(res) {
    const { lat, lon, dist, nation } = res;
    const isEng = nation === "England", isWal = nation === "Wales", isSco = nation === "Scotland", unknown = nation === "Unknown";
    const jobs = [];
    const job = (key, label, fn) => jobs.push({ key, label, run: () => fn().catch((e) => { res.errors[key] = e.message; (res.errorUrls = res.errorUrls || {})[key] = e.url || null; throw e; }) });
    if (isEng || unknown) job("zone", "Flood zone at the point (England)", () => FRC.ea.zoneAtPoint(lat, lon).then((v) => { if (isEng || v.zone) res.zone = { kind: "england", ...v }; }));
    if (isWal || unknown) job("zone", "Flood zone at the point (Wales)", () => FRC.nrw.zoneAtPoint(lat, lon).then((v) => { if (isWal || v.hits.length) res.zone = { kind: "wales", ...v }; }));
    if (isSco || unknown) job("zone", "Flood maps at the point (Scotland)", () => FRC.sepa.floodAtPoint(lat, lon).then((v) => { if (isSco || Object.keys(v.found).length) res.zone = { kind: "scotland", ...v }; }));
    if (isEng || unknown) {
      job("band", "Long-term risk band", () => FRC.ea.riskBand(lat, lon).then((v) => (res.band = v)));
      job("live", "Flood warnings", () => FRC.ea.liveWarnings(lat, lon, dist).then((v) => { res.live = v; res.liveAt = new Date(); }));
      job("gauges", "River gauges", () => FRC.ea.nearbyGauges(lat, lon, dist).then((v) => { res.gauges = v; res.liveAt = res.liveAt || new Date(); }));
    }
    return jobs;
  }

  // ---------- Try again for the parts that failed ----------
  // Only failed parts are fetched again; results that came back stay as they are.
  const failedConnections = () => CHECKS.map((c, i) => i).filter((i) => { const el = $("chk" + i); return el && el.classList.contains("bad"); });
  const failedAnalysis = () => (state.analysis ? state.analysis.datasets.filter((d) => FRC.floodAnalysis.RETRY.includes(d.status)) : []);
  const failedPoint = (res) => (res ? Object.keys(res.errors) : []);
  const failedTiles = () => Object.keys(FRC.mapLayers.tileErrors || {});
  function failures() {
    return failedPoint(state.current).length + failedPoint(state.siteCheck).length + failedAnalysis().length + failedConnections().length + failedTiles().length + (state.analysisError ? 1 : 0);
  }
  // For a partial result, only the notes that say what is missing (not the
  // notes about overlaps or how areas were measured).
  const partialReason = (d) => {
    const why = (d.notes || []).filter((n) => /did not return|only part|result limit|could not/i.test(n));
    return why.length ? why.join(" ") : "Only part of the data came back.";
  };
  // Every part failing now, for the error log.
  function failingParts() {
    const out = [];
    [[state.current, "pt", "Point"], [state.siteCheck, "site", "Site centre"]].forEach(([res, tag, where]) => {
      if (!res) return;
      const jobs = pointJobs(res);
      failedPoint(res).forEach((k) => { const j = jobs.find((x) => x.key === k); out.push({ key: `${tag}:${k}`, what: `${where}: ${j ? j.label : k}`, message: res.errors[k], url: (res.errorUrls || {})[k] }); });
    });
    failedAnalysis().forEach((d) => out.push({ key: "ds:" + d.id, what: "Site: " + d.name, message: d.error || (d.status === "partial" ? partialReason(d) : d.statusText), url: d.errorUrl }));
    if (state.analysisError) out.push({ key: "analysis", what: "Site analysis", message: state.analysisError });
    failedConnections().forEach((i) => out.push({ key: "conn:" + i, what: "Connection: " + CHECKS[i][0], message: $("chk" + i).title, url: $("chk" + i).dataset.url || null }));
    failedTiles().forEach((k) => out.push({ key: "tile:" + k, what: "Map layer: " + FRC.mapLayers.tileErrors[k], message: "Some map tiles did not load." }));
    return out;
  }
  function updateRetry() {
    const n = failures();
    const title = `Try again for the ${n} part${n === 1 ? "" : "s"} that failed. Results that worked are kept.`;
    ["retryBtn", "errLogRetry"].forEach((id) => {
      const btn = $(id);
      if (!btn) return;
      btn.hidden = n === 0 || state.retrying;
      btn.title = title; btn.setAttribute("aria-label", title);
    });
    // While trying again, parts are briefly cleared before they run, so the
    // log is only updated once the retry has finished.
    if (!state.retrying) FRC.errorLog.sync(failingParts(), { retried: state.justRetried });
  }
  async function retryFailed() {
    if (state.retrying) return;
    state.retrying = true; updateRetry();
    try {
      const work = [];
      // Point checks: run each failed job again.
      [state.current, state.siteCheck].forEach((res) => {
        if (!res || !failedPoint(res).length) return;
        const keys = failedPoint(res);
        keys.forEach((k) => delete res.errors[k]);
        work.push(Promise.all(pointJobs(res).filter((j) => keys.includes(j.key))
          .map((j) => FRC.progress.track(j.run(), "Again: " + j.label).catch(() => {}))).then(() => { res.when = new Date(); if (res === reportCheck()) FRC.map.showGauges(res.gauges); }));
      });
      // Site datasets that were unavailable, failed or only partly returned.
      if (state.analysisError && state.site.features.length) { state.analysisError = null; work.push(runSiteCheck()); }
      else if (failedAnalysis().length) {
        const seq = state.analysisSeq, a = state.analysis;
        work.push(FRC.floodAnalysis.retryFailed(a, state.site.features).then((b) => {
          if (seq !== state.analysisSeq) return; // the site changed meanwhile
          state.analysis = b; FRC.map.showAnalysis(b);
        }));
      }
      // Map layers with tiles that did not load: draw them again.
      if (failedTiles().length) FRC.mapLayers.retryTiles();
      // Data connections that were blocked.
      const blocked = failedConnections();
      if (blocked.length) work.push(testConnections(blocked));
      await Promise.all(work);
    } finally {
      state.retrying = false;
      state.justRetried = true;
      renderDashboard();
      state.justRetried = false;
      const n = failures();
      setStatus(n ? `Tried again. ${n} part${n === 1 ? " still has" : "s still have"} no result.` : "Tried again. Everything came back.");
    }
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
      // The map and the page stay where they are, so the pinned place stays in view.
      FRC.map.showAnalysis(a);
    } catch (e) {
      if (seq === state.analysisSeq) { state.analysing = false; state.analysisError = e.message; renderDashboard(); }
    } finally {
      $("siteCheckBtn").disabled = !state.site.features.length;
    }
  }

  async function searchPostcode(pc) {
    pc = String(pc || "").trim();
    if (!pc) return;
    if (!FRC.location.isPostcode(pc)) { setStatus("That doesn't look like a UK postcode. Check it, for example YO1 7HH."); return; }
    setStatus("Looking up postcode…");
    try {
      const place = await FRC.progress.track(FRC.location.lookupPostcode(pc), "Finding the postcode");
      if (!place || !Number.isFinite(place.latitude) || !Number.isFinite(place.longitude)) {
        setStatus("The postcode service returned no usable location. Check the postcode and try again.");
        return;
      }
      // Finding the postcode only places the pin; the checks start with Check.
      if (FRC.boundaryDraw.hasOwn()) { FRC.map.get().setView([place.latitude, place.longitude], 15); setStatus("Your own boundary is the site. Press Clear to put a pin at this postcode instead."); }
      else placePin(place.latitude, place.longitude, place);
    } catch (e) {
      const notFound = /404/.test(e.message);
      setStatus(notFound ? "That postcode was not found. Check it and try again." : "Could not reach the postcode service. Try again, or click the map instead.");
      if (!notFound) FRC.errorLog.note("Postcode lookup: " + pc, e.message, e.url);
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
  // Messages under the map show for a few seconds, then fade; every message
  // is kept in the Log, so the map area stays clean.
  let statusTimer = null;
  function setStatus(text) {
    const el = $("status");
    clearTimeout(statusTimer);
    el.classList.remove("fade");
    el.textContent = text;
    if (!text) return;
    if (!/…$/.test(text)) FRC.errorLog.info(text);
    statusTimer = setTimeout(() => { el.classList.add("fade"); statusTimer = setTimeout(() => { el.textContent = ""; el.classList.remove("fade"); }, 700); }, /…$/.test(text) ? 60000 : 5000);
  }
  const SLOW_S = 5;
  // A short warning under the map when a service is blocked or slow, so the
  // user knows before the results come back.
  let lastNetWarning = "";
  function showNetWarning(quiet) {
    const blocked = [], slow = [];
    CHECKS.forEach((c, i) => { const p = $("chk" + i); if (!p) return; if (p.classList.contains("bad")) blocked.push(c[0]); else if (p.dataset.slow) slow.push(`${c[0]} (${p.dataset.slow} s)`); });
    const parts = [];
    if (blocked.length) parts.push(`Not reachable right now: ${blocked.join(", ")}. Results from ${blocked.length === 1 ? "it" : "them"} may be missing.`);
    if (slow.length) parts.push(`Slow right now: ${slow.join(", ")}. The check may take longer.`);
    // Shown briefly under the map and kept in the Log; never drawn over the map.
    const text = parts.join(" ");
    if (text && text !== lastNetWarning) { if (quiet) FRC.errorLog.info(text); else setStatus(text); }
    lastNetWarning = text;
  }
  // Before a check, test the connections again if the last test is over
  // PRECHECK_MIN minutes old. It runs alongside the check, not before it.
  const PRECHECK_MIN = 5;
  function precheck() {
    if (state.connTestedAt && Date.now() - state.connTestedAt < PRECHECK_MIN * 60000) return;
    testConnections();
  }
  // only: indexes of the checks to run again (the others keep their result).
  // quiet: the background test at page open. Results go to the Data
  // connections panel and the Log only; nothing pops up or opens.
  async function testConnections(only, { quiet = false } = {}) {
    const ul = $("checks");
    if (!only || !ul.children.length) ul.innerHTML = CHECKS.map((c, i) => `<li><span>${esc(c[0])}</span><span class="pill neutral" id="chk${i}">Testing</span></li>`).join("");
    const which = only || CHECKS.map((c, i) => i);
    state.connTestedAt = Date.now();
    // Tested without remembered results, and timed: a service that takes
    // longer than SLOW_S seconds is marked Slow.
    await FRC.util.fresh(() => Promise.all(which.map(async (i) => {
      const c = CHECKS[i], el = $("chk" + i);
      el.className = "pill neutral"; el.textContent = "Testing"; el.title = ""; delete el.dataset.url; delete el.dataset.slow;
      const t0 = Date.now();
      try {
        await c[1]();
        const secs = (Date.now() - t0) / 1000;
        const slow = secs > SLOW_S;
        el.className = slow ? "pill warn" : "pill info"; el.textContent = slow ? "Slow" : "Working";
        el.title = `Answered in ${secs.toFixed(1)} s`;
        if (slow) el.dataset.slow = secs.toFixed(1);
      } catch (e) { el.className = "pill bad"; el.textContent = "Blocked"; el.title = e.message; if (e.url) el.dataset.url = e.url; }
    })));
    updateRetry();
    showNetWarning(quiet);
    // The panel is folded away; open it when a service cannot be reached
    // (not for the quiet test at page open).
    const blocked = ul.querySelectorAll(".pill.bad").length;
    const panel = ul.closest("details");
    if (panel) { panel.open = panel.open || (blocked > 0 && !quiet); panel.querySelector("summary").textContent = blocked ? `Data connections: ${blocked} blocked` : "Data connections: all working"; }
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
      // With a boundary of the user's own, that boundary stays the site.
      if (FRC.boundaryDraw.hasOwn()) setStatus("Your own boundary is the site. Press Check to start, or Clear to drop a pin instead.");
      else placePin(e.latlng.lat, e.latlng.lng);
    });
    // "i" buttons: click shows or hides the help text they point to.
    let helpOpenedAt = 0;
    // One handler for every "i" button, including those drawn later in the
    // results, so each opens or closes its note (and never folds a section).
    document.addEventListener("click", (e) => {
      const b = e.target.closest("button.info, button.info-btn");
      if (!b) return;
      e.preventDefault(); e.stopPropagation();
      const t = $(b.getAttribute("aria-controls"));
      if (!t) return;
      const open = t.hidden;
      // One note at a time.
      document.querySelectorAll("button.info[aria-expanded=true], button.info-btn[aria-expanded=true]").forEach((o) => { if (o !== b) { const n = $(o.getAttribute("aria-controls")); if (n) n.hidden = true; o.setAttribute("aria-expanded", "false"); } });
      t.hidden = !open; b.setAttribute("aria-expanded", String(open));
      helpOpenedAt = Date.now();
    });
    // Help notes stay open only while the user is reading them: moving the
    // map, scrolling, or pressing or tapping anything else closes them.
    const closeHelp = () => document.querySelectorAll("button.info[aria-expanded=true], button.info-btn[aria-expanded=true]").forEach((b) => {
      const n = $(b.getAttribute("aria-controls")); if (n) n.hidden = true; b.setAttribute("aria-expanded", "false");
    });
    document.addEventListener("click", (e) => { if (!e.target.closest("button.info, button.info-btn, .help")) closeHelp(); }, true);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeHelp(); });
    map.on("movestart zoomstart", closeHelp);
    // Scrolling closes notes, but not the small scroll that can follow opening one.
    const onScroll = () => { if (Date.now() - helpOpenedAt > 600) closeHelp(); };
    root.addEventListener("scroll", onScroll, { passive: true });
    $("side").addEventListener("scroll", onScroll, { passive: true });
    // Postcode search opens from the search button on the map.
    const openSearch = (open) => {
      $("searchPanel").hidden = !open; $("searchToggle").setAttribute("aria-expanded", String(open));
      if (open) $("postcode").focus();
    };
    $("searchToggle").addEventListener("click", () => openSearch($("searchPanel").hidden));
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("searchPanel").hidden) { openSearch(false); $("searchToggle").focus(); } });
    $("radius").addEventListener("change", () => {
      // Takes effect at the next Check.
      if (state.siteCheck || state.current) setStatus("Search radius changed. Press Check to update the warnings and gauges.");
    });

    $("clearBtn").addEventListener("click", () => FRC.boundaryDraw.clear());
    $("importInput").addEventListener("change", (e) => { const f = e.target.files[0]; if (f) importFile(f); e.target.value = ""; });
    $("exportBtn").addEventListener("click", () => FRC.boundaryExport.download(state.site.features, state.site.measured, $("siteName").value.trim()));
    // Check always asks the services again; pin drops and edits may reuse
    // results remembered from the last hour.
    $("siteCheckBtn").addEventListener("click", () => FRC.util.fresh(runSiteCheck));
    $("cacheClear").addEventListener("click", () => { FRC.util.cache.clear(); $("cacheMsg").textContent = "Saved results cleared."; });
    // Try again always asks the services again, never saved results.
    $("retryBtn").addEventListener("click", () => FRC.util.fresh(retryFailed));
    $("errLogRetry").addEventListener("click", () => FRC.util.fresh(retryFailed));
    FRC.errorLog.init();
    FRC.mapLayers.onTileError = updateRetry;
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
      state.building = true; btn.disabled = true; btn.querySelector("span").textContent = "Building…";
      try {
        await FRC.progress.track(FRC.pdfReport.build(reportCheck(), state.site, state.analysis, {
          company: $("company").value.trim(), logo: state.logo,
          siteName: $("siteName").value.trim(), ref: $("ref").value.trim(), analyst: $("analyst").value.trim(), checkedBy: $("checkedBy").value.trim(), version: $("version").value.trim(), notes: $("notes").value.trim(),
          gaps: failingParts().filter((g) => !/^(tile|conn):/.test(g.key)),
          sections: { location: $("o-location").checked, zone: $("o-zone").checked, intersect: $("o-intersect").checked, other: $("o-other").checked, live: $("o-live").checked, maps: $("o-maps").checked },
        }), "Building the PDF report");
      } catch (e) { setStatus("Could not build the PDF: " + e.message); }
      state.building = false; btn.disabled = !pdfReady(); btn.querySelector("span").textContent = "Report";
    });
    $("checkBtn").addEventListener("click", () => testConnections());

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
    // Test the data connections in the background once the page and map have
    // loaded, so the test does not slow the first map images.
    const bg = () => setTimeout(() => testConnections(undefined, { quiet: true }), 300);
    if (document.readyState === "complete") bg(); else window.addEventListener("load", bg, { once: true });
  }

  FRC.app = { start, runCheck, runSiteCheck, searchPostcode, importFile, recomputeSite };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})(window);
