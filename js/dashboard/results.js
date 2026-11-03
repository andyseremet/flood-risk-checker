// Results dashboard: site measurements, flood analysis, live data and data status.
// Status wording follows the agreed vocabulary, so a missing result is never
// shown as "safe": Data retrieved · No mapped feature identified · Not assessed ·
// Service unavailable.
(function (root) {
  "use strict";
  const FRC = (root.FRC = root.FRC || {});
  const { esc, fmtDate, fmtNum } = FRC.util;

  const STATUS = {
    retrieved: ["info", "Data retrieved"],
    none: ["info", "No mapped feature identified"],
    notAssessed: ["neutral", "Not assessed"],
    unavailable: ["bad", "Service unavailable"],
  };

  function zoneSummary(res) {
    const z = res.zone;
    const C = FRC.config;
    if (res.nation === "Northern Ireland") return { status: "notAssessed", pill: ["neutral", "Not covered"], text: "Northern Ireland flood map data is not open. Check the official Flood Maps NI viewer (infrastructure-ni.gov.uk)." };
    if (!z) return res.errors.zone
      ? { status: "unavailable", pill: ["bad", "Unavailable"], text: "Could not reach the flood zone service: " + res.errors.zone }
      : { status: "notAssessed", pill: ["neutral", "No data"], text: "No flood-zone result was returned. This is not evidence that the location is free from flood risk." };
    if (z.kind === "england") {
      if (!z.zone) return { status: "none", pill: ["info", "No mapped polygon"], text: "No Flood Zone 2 or 3 polygon was identified at this point in the queried dataset. This result alone does not establish a definitive Flood Zone 1 classification; check the current official planning map and any relevant site-specific information." };
      const src = z.sources.length ? ` Source: ${z.sources.join(" and ")}.` : "";
      return { status: "retrieved", pill: ["info", z.zone.replace("FZ", "Zone ")], text: C.zoneMeaning[z.zone] + src };
    }
    if (z.kind === "wales") {
      const cls = "info";
      const text = z.matchedFeatures === 0
        ? "No mapped polygon was identified by this query. This does not establish that the location is free from flood risk; consult the current Natural Resources Wales mapping."
        : "Natural Resources Wales Flood Map for Planning (rivers and sea).";
      return { status: z.matchedFeatures ? "retrieved" : "none", pill: [cls, z.zone], text };
    }
    const entries = Object.entries(z.found);
    if (!entries.length) return { status: "none", pill: ["info", "No feature identified"], text: "The SEPA identify query returned no matching flood feature. This is not a guarantee that the location is free from flood risk; consult SEPA's current flood maps for confirmation." };
    return { status: "retrieved", pill: ["info", "In flood extent"], text: entries.map(([s, l]) => `${s}: ${l} likelihood (${C.sepaMeaning[l]})`).join(". ") + "." };
  }

  // Classifications use one neutral colour: colour is kept for data status
  // (unavailable, partial), never to suggest that a site is safe or unsafe.
  function bandClass() { return "info"; }

  // Overall data status for each dataset, used on screen and in the PDF.
  function dataStatus(res) {
    const isEng = res.nation === "England" || res.nation === "Unknown";
    const row = (name, st, when) => ({ name, status: STATUS[st], when });
    return [
      row("Flood zone", zoneSummary(res).status, res.zone && res.zone.retrieved),
      isEng ? row("Long-term risk band", res.errors.band ? "unavailable" : res.band ? (res.band.band ? "retrieved" : "none") : "notAssessed", res.band && res.band.retrieved) : row("Long-term risk band", "notAssessed"),
      isEng ? row("Live warnings", res.errors.live ? "unavailable" : res.live ? "retrieved" : "notAssessed", res.liveAt) : row("Live warnings", "notAssessed"),
      isEng ? row("River gauges", res.errors.gauges ? "unavailable" : res.gauges ? "retrieved" : "notAssessed", res.liveAt) : row("River gauges", "notAssessed"),
    ];
  }

  const pill = (cls, text) => `<span class="pill ${cls}">${esc(text)}</span>`;

  const ANALYSIS_PILL = { completed: "info", none: "info", partial: "warn", notAssessed: "neutral", unavailable: "bad", error: "bad" };

  // One-sentence finding per group, worded so a missing polygon is never "safe".
  function groupFinding(g, noneText) {
    const pct = (v) => v.toFixed(1) + "%";
    if (g.extent === "none") return `No mapped polygon intersects the site (${noneText.toLowerCase()} across 100% of the site).`;
    const parts = g.rows.map((r) => `${r.label} ${pct(r.percent)}`).join(", ");
    return g.extent === "whole" ? `The whole site lies within mapped polygons: ${parts}.` : `Part of the site (${pct(g.coveredPercent)}) lies within mapped polygons: ${parts}.`;
  }

  function analysisTable(g, noneText) {
    const tr = (label, area, pctv, cls = "") => `<tr class="${cls}"><td>${esc(label)}</td><td class="num">${fmtNum(area, 0)}</td><td class="num">${pctv.toFixed(1)}%</td></tr>`;
    return `<div class="tablewrap"><table class="data"><thead><tr><th>Classification</th><th class="num">Area m²</th><th class="num">% of site</th></tr></thead><tbody>` +
      g.rows.map((r) => tr(r.label, r.area, r.percent)).join("") +
      tr(noneText, g.remainingArea, g.remainingPercent, "muted") +
      tr("Total site", g.siteArea, 100, "total") + `</tbody></table></div>`;
  }

  FRC.results = {
    groupFinding,
    analysisTable,

    zoneSummary,
    bandClass,
    dataStatus,

    renderSite(el, site) {
      if (!site || !site.features.length) {
        el.innerHTML = `<p class="hint">No site boundary yet. Draw one with the polygon or rectangle tool on the map, or import a file.</p>` +
          (site && site.errors.length ? site.errors.map((e) => `<p class="msg bad">${esc(e)}</p>`).join("") : "");
        return;
      }
      const m = site.measured;
      const [lon, lat] = m.centroidWGS || [NaN, NaN];
      const [e, n] = m.centroidBNG || [NaN, NaN];
      let html = `<dl class="kv">
        <dt>Parcels</dt><dd>${m.parcels.length}${m.holes ? ` (with ${m.holes} hole${m.holes > 1 ? "s" : ""})` : ""}</dd>
        <dt>Site area</dt><dd class="mono">${fmtNum(m.area, 0)} m²</dd>
        <dt></dt><dd class="mono">${fmtNum(m.hectares, 2)} ha · ${fmtNum(m.acres, 2)} acres</dd>
        <dt>Perimeter</dt><dd class="mono">${fmtNum(m.perimeter, 1)} m</dd>
        <dt>Centroid</dt><dd class="mono">${lat.toFixed(6)}, ${lon.toFixed(6)}</dd>
        <dt>Grid ref</dt><dd class="mono">E ${fmtNum(e, 1)}, N ${fmtNum(n, 1)}</dd>
      </dl>`;
      if (m.parcels.length > 1 || m.holes) {
        html += `<div class="tablewrap"><table class="data"><thead><tr><th>Parcel</th><th class="num">Area m²</th><th class="num">ha</th><th class="num">Perimeter m</th><th></th></tr></thead><tbody>` +
          m.parcels.map((p, i) => `<tr><td><button type="button" class="link" data-zoom="${i}">${esc(p.name)}</button></td><td class="num">${fmtNum(p.area, 0)}</td><td class="num">${fmtNum(p.area / 10000, 2)}</td><td class="num">${fmtNum(p.perimeter, 1)}</td><td><button type="button" class="link" data-remove="${i}" aria-label="Remove ${esc(p.name)}">Remove</button></td></tr>`).join("") +
          `</tbody></table></div>`;
      } else {
        html += `<div class="row"><button type="button" class="link" data-zoom="0">Zoom to site</button><button type="button" class="link" data-remove="0">Remove</button></div>`;
      }
      html += site.warnings.map((w) => `<p class="msg warn">${esc(w)}</p>`).join("");
      html += site.errors.map((w) => `<p class="msg bad">${esc(w)}</p>`).join("");
      html += `<p class="hint">Measured in British National Grid (EPSG:27700) from the boundary's corner points.</p>`;
      el.innerHTML = html;
    },

    // The results dashboard, in the five sections of the spec:
    // A site information, B flood-zone assessment, C additional flood
    // information, D live environmental information, E assessment status.
    renderDashboard(el, { site, current: res, analysis: a, siteName, analysing, analysisError }) {
      const hasSite = site && site.features.length > 0;
      if (!hasSite && !res) { el.innerHTML = ""; return; }
      const sec = (id, letter, title, body) => `<details class="dash-sec" id="dash-${id}" open><summary><h3><span class="dash-letter">${letter}</span>${esc(title)}</h3></summary>${body}</details>`;
      const block = (title, pillHtml, body) => `<div class="result"><div class="title"><span>${esc(title)}</span>${pillHtml || ""}</div>${body}</div>`;
      const when = (d) => d ? `<p class="hint">Retrieved ${esc(fmtDate(d))}.</p>` : "";
      const byId = (id) => a && a.datasets.find((d) => d.id === id);
      const assessed = (d) => d && d.status !== "notAssessed";
      const datasetBody = (d) => {
        let h = "";
        if (d.error) h += `<p>${esc(d.error)}</p>`;
        if (d.summary) h += `<p>${esc(d.summary)}</p>`;
        (d.groups || []).forEach((g) => {
          if (d.groups.length > 1 || g.group !== d.nation) h += `<p><strong>${esc(g.group)}</strong></p>`;
          h += `<p>${esc(groupFinding(g, d.noneText))}</p>` + analysisTable(g, d.noneText);
        });
        h += d.notes.map((n) => `<p class="hint">${esc(n)}</p>`).join("");
        return h + when(d.retrieved);
      };
      const pending = analysing
        ? `<p class="hint">Fetching flood polygons for the site and calculating intersections…</p>`
        : analysisError ? `<p class="msg bad">${esc("The site analysis could not be completed: " + analysisError)}</p>`
        : hasSite ? `<p class="hint">Press <strong>Analyse site</strong> to measure how much of the site lies in each mapped area.</p>`
        : `<p class="hint">Draw or import a site boundary to measure how much of it lies in each mapped area.</p>`;

      // A. Site information
      const p = res && res.place;
      const m = hasSite ? site.measured : null;
      let A = `<dl class="kv">
        <dt>Site name</dt><dd>${esc(siteName || "Not given")}</dd>
        <dt>Location</dt><dd>${esc((p && [p.admin_ward, p.admin_district].filter(Boolean).join(", ")) || "-")}</dd>
        <dt>Postcode</dt><dd>${esc((p && p.postcode) || "Not found")}</dd>
        <dt>Country</dt><dd>${esc((res && res.nation) || (a && a.nation) || "Not checked yet")}${res && res.place && res.place.nearBorder ? " (near a national border, so every agency's data is checked)" : ""}</dd>`;
      if (m) A += `
        <dt>Site area</dt><dd class="mono">${fmtNum(m.area, 0)} m² · ${fmtNum(m.hectares, 2)} ha · ${fmtNum(m.acres, 2)} acres</dd>
        <dt>Perimeter</dt><dd class="mono">${fmtNum(m.perimeter, 1)} m</dd>
        <dt>Centroid</dt><dd class="mono">${m.centroidWGS[1].toFixed(6)}, ${m.centroidWGS[0].toFixed(6)}</dd>
        <dt>Grid ref</dt><dd class="mono">E ${fmtNum(m.centroidBNG[0], 1)}, N ${fmtNum(m.centroidBNG[1], 1)}</dd>`;
      else if (res) A += `
        <dt>Coordinates</dt><dd class="mono">${res.lat.toFixed(5)}, ${res.lon.toFixed(5)}</dd>
        ${p && p.eastings ? `<dt>Grid ref</dt><dd class="mono">E ${p.eastings}, N ${p.northings}</dd>` : ""}`;
      A += `</dl>`;
      if (!m) A += `<p class="hint">No site boundary yet: these results are for a single point.</p>`;

      // B. Flood-zone assessment
      let B = "";
      const zoneSets = a ? a.datasets.filter((d) => d.primary) : [];
      if (a) {
        a.notes.forEach((n) => { B += `<p class="msg warn">${esc(n)}</p>`; });
        zoneSets.filter(assessed).forEach((d) => { B += block(d.name, pill(ANALYSIS_PILL[d.status], d.statusText), datasetBody(d)); });
        B += `<p class="hint">The mapped parts of the site are shaded on the map: darkest for the most severe class. Areas are measured in British National Grid. Overlapping polygons are counted once, in the more severe class.</p>`;
      } else B += pending;
      if (res) {
        const z = zoneSummary(res);
        B += block(res.fromSite ? "Flood zone at the site centroid" : "Flood zone at this point", pill(z.pill[0], z.pill[1]), `<p>${esc(z.text)}</p>` + when(res.zone && res.zone.retrieved));
        if (res.band || res.errors.band) {
          B += res.errors.band
            ? block("Long-term risk, rivers and sea (England)", pill("bad", "Service unavailable"), `<p>${esc(res.errors.band)}</p>`)
            : res.band.band
              ? block("Long-term risk, rivers and sea (England)", pill("info", res.band.band), `<p>Environment Agency risk band at ${res.fromSite ? "the site centroid" : "this point"}, taking flood defences into account.</p>` + when(res.band.retrieved))
              : block("Long-term risk, rivers and sea (England)", pill("info", "No band mapped"), `<p>No risk band was returned at this point. This is not a confirmed "very low" result: the service's point answers are not reliable, so check the risk band map layer.</p>` + when(res.band.retrieved));
        }
      }

      // C. Additional flood information
      let C = "";
      if (a) {
        a.datasets.filter((d) => !zoneSets.includes(d) && d.id !== "gw" && assessed(d))
          .forEach((d) => { C += block(d.name, pill(ANALYSIS_PILL[d.status], d.statusText), datasetBody(d)); });
        if (!C) C += `<p class="hint">Surface water, reservoir and recorded flood data are currently available for sites in England only.${a.nation === "Scotland" ? " For Scotland, surface water and coastal extents are part of the SEPA analysis in section B." : ""}</p>`;
        const gw = byId("gw");
        if (gw) C += block("Groundwater flooding", pill(ANALYSIS_PILL.notAssessed, gw.statusText), `<p class="hint">${esc(gw.notes[0])}</p>`);
      } else C += pending;

      // D. Live environmental information
      let D = "";
      if (!res) D = `<p class="hint">Not checked yet.</p>`;
      else if (res.nation !== "England" && res.nation !== "Unknown") D = `<p class="hint">Live warnings and river gauges are available for England only.</p>`;
      else {
        if (res.errors.live) D += block("Flood warnings and alerts", pill("bad", "Service unavailable"), `<p>${esc(res.errors.live)}</p>`);
        else if (res.live) D += block(`Flood warnings and alerts within ${res.dist} km`, pill("info", res.live.length ? res.live.length + " in force" : "None in force"),
          (res.live.length ? res.live.map((w) => `<p><strong>${esc(w.severity)}</strong>: ${esc(w.description)} <span class="hint">(raised ${esc(fmtDate(w.raised))})</span></p>`).join("") : `<p>No flood warnings or alerts in force.</p>`) + when(res.liveAt));
        if (res.errors.gauges) D += block("River gauges", pill("bad", "Service unavailable"), `<p>${esc(res.errors.gauges)}</p>`);
        else if (res.gauges) D += block(`River gauges within ${res.dist} km`, pill("info", res.gauges.length ? res.gauges.length + " found" : "None found"),
          (res.gauges.length ? `<div class="tablewrap"><table class="data"><thead><tr><th>Gauge</th><th class="num">Distance</th><th class="num">Latest level</th><th>Reading time</th></tr></thead><tbody>` +
            res.gauges.map((g) => `<tr><td>${esc(g.name)}${g.river ? `<br><span class="hint">${esc(g.river)}</span>` : ""}</td><td class="num">${g.km.toFixed(1)} km</td><td class="num">${g.value != null ? g.value.toFixed(2) + " " + esc(g.unit || "m") : "-"}</td><td>${g.value != null ? esc(fmtDate(g.time)) : "No recent reading"}</td></tr>`).join("") +
            `</tbody></table></div>` : `<p>No river level gauges in this radius.</p>`) + when(res.liveAt));
        D += `<p class="hint">Live data is for ${res.fromSite ? "the site centroid" : "this point"}. Change the radius in the Report card.</p>`;
      }

      // Summary: risk by source and the next step (answer first).
      let S = "";
      if (FRC.assessment && (a || res)) {
        const nation = (a && a.nation) || (res && res.nation);
        const risk = FRC.assessment.riskBySource({ analysis: a, res, nation });
        const fra = FRC.assessment.fraNeed({ analysis: a, res, site, nation, rows: risk });
        const link = (u) => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(u.replace(/^https:\/\/(www\.)?/, "").split("/")[0])}</a>`;
        S += `<div class="result"><div class="title"><span>Is a full Flood Risk Assessment needed?</span></div><p><strong>${esc(fra.headline)}</strong></p>` +
          `<ul>${fra.reasons.map((t) => `<li>${esc(t)}</li>`).join("")}</ul><p><strong>Next steps</strong></p><ol>${fra.actions.map((t) => `<li>${esc(t)}</li>`).join("")}</ol>` +
          `<p class="hint">Guidance: ${fra.links.map(link).join(" · ")}. The local planning authority makes the final decision.</p></div>`;
        S += `<div class="tablewrap"><table class="data"><thead><tr><th>Source of flooding</th><th>Rating</th><th>Evidence</th></tr></thead><tbody>` +
          risk.map((r) => `<tr><td>${esc(r.source)}</td><td>${pill(r.level == null ? (r.rating === "No result" ? "bad" : "neutral") : "info", r.rating)}</td><td class="hint">${esc(r.evidence)}</td></tr>`).join("") +
          `</tbody></table></div><p class="hint">None mapped means no mapped feature was found; it is not a confirmed low risk.${analysing ? " The site analysis is still running, so this summary will update." : ""}</p>`;
        const cn = FRC.assessment.climateNote(nation);
        S += `<p class="hint">${esc(cn.text)} ${link(cn.link)}</p>`;
      }

      // E. Assessment status
      const rows = [];
      if (a) a.datasets.forEach((d) => rows.push({ name: d.name.split(" (")[0], cls: ANALYSIS_PILL[d.status], status: d.statusText, when: d.retrieved, why: d.status === "notAssessed" ? d.notes[0] : d.error }));
      else if (hasSite) rows.push({ name: "Site-wide analysis", cls: "neutral", status: analysing ? "In progress" : "Not assessed", why: analysing ? "" : "Not run yet." });
      if (res) dataStatus(res).forEach((r) => rows.push({ name: r.name + (res.fromSite ? " (site centroid)" : " (point)"), cls: r.status[0], status: r.status[1], when: r.when }));
      const E = `<div class="tablewrap"><table class="data status"><thead><tr><th>Dataset</th><th>Status</th></tr></thead><tbody>` +
        rows.map((r) => `<tr><td>${esc(r.name)}${r.why ? `<br><span class="hint">${esc(r.why)}</span>` : ""}${r.when ? `<br><span class="hint">Retrieved ${esc(fmtDate(r.when))}</span>` : ""}</td><td>${pill(r.cls, r.status)}</td></tr>`).join("") +
        `</tbody></table></div><p class="hint">A missing map feature, unavailable service or empty result is not evidence that a site is free from flood risk, and never means Flood Zone 1.</p>`;

      el.innerHTML = (S ? sec("summary", "!", "Summary: risk by source and next step", S) : "") + sec("site", "A", "Site information", A) + sec("zones", "B", "Flood-zone assessment", B) +
        sec("other", "C", "Additional flood information", C) + sec("live", "D", "Live environmental information", D) +
        sec("status", "E", "Assessment status", E);
    },
  };
})(typeof window !== "undefined" ? window : globalThis);
