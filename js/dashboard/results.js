// Results panel: site measurements, flood-data results and data status.
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
      return { status: "retrieved", pill: [z.zone === "FZ3" ? "bad" : "warn", z.zone.replace("FZ", "Zone ")], text: C.zoneMeaning[z.zone] + src };
    }
    if (z.kind === "wales") {
      const cls = /3/.test(z.zone) ? "bad" : /2/.test(z.zone) || /mapped flood zone/i.test(z.zone) ? "warn" : "info";
      const text = z.matchedFeatures === 0
        ? "No mapped polygon was identified by this query. This does not establish that the location is free from flood risk; consult the current Natural Resources Wales mapping."
        : "Natural Resources Wales Flood Map for Planning (rivers and sea).";
      return { status: z.matchedFeatures ? "retrieved" : "none", pill: [cls, z.zone], text };
    }
    const entries = Object.entries(z.found);
    if (!entries.length) return { status: "none", pill: ["info", "No feature identified"], text: "The SEPA identify query returned no matching flood feature. This is not a guarantee that the location is free from flood risk; consult SEPA's current flood maps for confirmation." };
    const worst = entries.some(([, l]) => l === "High") ? "bad" : entries.some(([, l]) => l === "Medium") ? "warn" : "info";
    return { status: "retrieved", pill: [worst, "In flood extent"], text: entries.map(([s, l]) => `${s}: ${l} likelihood (${C.sepaMeaning[l]})`).join(". ") + "." };
  }

  function bandClass(b) { b = (b || "").toLowerCase(); return b.includes("high") ? "bad" : b.includes("medium") ? "warn" : "info"; }

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

  FRC.results = {
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

    renderResults(el, res) {
      const p = res.place;
      const z = zoneSummary(res);
      let html = `<div class="result"><div class="title"><span>${res.fromSite ? "Site centroid" : "Location"}</span>${pill("neutral", res.nation)}</div>
        <dl class="kv">
          <dt>Postcode</dt><dd>${esc((p && p.postcode) || "Not found")}</dd>
          <dt>Area</dt><dd>${esc([p && p.admin_ward, p && p.admin_district].filter(Boolean).join(", ") || "-")}</dd>
          <dt>Coordinates</dt><dd class="mono">${res.lat.toFixed(5)}, ${res.lon.toFixed(5)}</dd>
          ${p && p.eastings ? `<dt>Grid ref</dt><dd class="mono">E ${p.eastings}, N ${p.northings}</dd>` : ""}
        </dl>${res.fromSite ? `<p class="hint">Flood data below is checked at the site's centroid. Checking the whole site area against flood zones comes in the next phase.</p>` : ""}</div>`;
      html += `<div class="result"><div class="title"><span>Flood zone</span>${pill(z.pill[0], z.pill[1])}</div><p>${esc(z.text)}</p></div>`;
      if (res.band || res.errors.band) {
        html += res.band
          ? (res.band.band
            ? `<div class="result"><div class="title"><span>Long-term risk (rivers and sea)</span>${pill(bandClass(res.band.band), res.band.band)}</div><p>Environment Agency risk band, taking flood defences into account.</p></div>`
            : `<div class="result"><div class="title"><span>Long-term risk (rivers and sea)</span>${pill("info", "No band mapped")}</div><p>No risk band was returned at this point. This is not a confirmed "very low" result.</p></div>`)
          : `<div class="result"><div class="title"><span>Long-term risk</span>${pill("bad", "Unavailable")}</div><p>${esc(res.errors.band)}</p></div>`;
      }
      if (res.live || res.errors.live) {
        if (res.errors.live) html += `<div class="result"><div class="title"><span>Live warnings</span>${pill("bad", "Unavailable")}</div><p>${esc(res.errors.live)}</p></div>`;
        else if (!res.live.length) html += `<div class="result"><div class="title"><span>Live warnings within ${res.dist} km</span>${pill("info", "None in force")}</div><p>No flood warnings or alerts in force at ${esc(fmtDate(res.liveAt))}.</p></div>`;
        else html += `<div class="result"><div class="title"><span>Live warnings within ${res.dist} km</span>${pill(res.live.some((w) => w.level <= 2) ? "bad" : "warn", res.live.length + " in force")}</div>${res.live.map((w) => `<p><strong>${esc(w.severity)}</strong>: ${esc(w.description)} <span class="hint">(${esc(fmtDate(w.raised))})</span></p>`).join("")}</div>`;
      }
      if (res.gauges && res.gauges.length) {
        html += `<div class="result"><div class="title"><span>Nearest river gauges</span></div>${res.gauges.map((g) => `<p>${esc(g.name)}${g.river ? ", " + esc(g.river) : ""} <span class="hint">${g.km.toFixed(1)} km</span><br><span class="mono">${g.value != null ? g.value.toFixed(2) + " m at " + esc(fmtDate(g.time)) : "No recent reading"}</span></p>`).join("")}</div>`;
      }
      html += `<div class="result"><div class="title"><span>Data status</span></div><ul class="checks">` +
        dataStatus(res).map((r) => `<li><span>${esc(r.name)}${r.when ? ` <span class="hint">${esc(fmtDate(r.when))}</span>` : ""}</span>${pill(r.status[0], r.status[1])}</li>`).join("") + `</ul></div>`;
      el.innerHTML = html;
    },
  };
})(typeof window !== "undefined" ? window : globalThis);
