// Turns the dataset results into the two answers a reader looks for first,
// following best practice for flood risk reports:
//   - riskBySource: one rating for each source of flooding (rivers, sea,
//     surface water, groundwater, sewers, reservoirs, historic floods), with a
//     source named and the reason given when it was not assessed.
//   - fraNeed: whether a full site-specific Flood Risk Assessment is likely to
//     be needed, using the published triggers for each nation, plus next steps.
// A source with no mapped feature is rated "None mapped", never "Low" or
// "Flood Zone 1": an empty result is not evidence of no risk.
// Used by the dashboard and the PDF report. No network calls.
(function (root) {
  "use strict";
  const FRC = (root.FRC = root.FRC || {});

  const LINKS = {
    fraEngland: "https://www.gov.uk/guidance/flood-risk-assessment-the-sequential-test-for-applicants",
    climateEngland: "https://www.gov.uk/guidance/flood-risk-assessments-climate-change-allowances",
    mapEngland: "https://flood-map-for-planning.service.gov.uk",
    fmfpWales: "https://www.naturalresourceswales.gov.uk/flooding/flood-map-for-planning",
    tan15: "https://www.gov.wales/technical-advice-note-15-development-flooding-and-coastal-erosion",
    sepaPlanning: "https://www.sepa.org.uk/environment/land/planning/guidance-and-advice-notes/",
    floodMapsNI: "https://www.infrastructure-ni.gov.uk/topics/flood-maps-ni",
  };

  // Order of the sources in the table.
  const SOURCES = ["Rivers", "Sea", "Rivers and sea", "Surface water", "Groundwater", "Sewers", "Reservoirs", "Historic flooding"];

  const pct = (v) => v.toFixed(1) + "%";
  const allRows = (d) => (d.groups || []).flatMap((g) => g.rows || []);
  const partialText = (d) => (d.status === "partial" ? " Partial data: some results may be missing." : "");
  const failed = (d) => d.status === "unavailable" || d.status === "error";
  const noResult = (source, d) => ({ source, rating: "No result", level: null, evidence: `${d.statusText}: ${d.error || "no data returned"}.`, nation: d.nation });

  // England and Wales planning flood zones (rivers and sea together).
  function zoneRows(d) {
    if (failed(d)) return [noResult("Rivers and sea", d)];
    const rows = allRows(d);
    const z3 = rows.filter((r) => /3$/.test(r.key)), z2 = rows.filter((r) => /2$/.test(r.key)), other = rows.filter((r) => /other$/.test(r.key));
    const sum = (a) => a.reduce((s, r) => s + r.percent, 0);
    let rating, level, evidence;
    if (z3.length) { rating = "High"; level = 3; evidence = `${pct(sum(z3))} of the site in Flood Zone 3` + (z2.length ? `, ${pct(sum(z2))} in Flood Zone 2.` : "."); }
    else if (z2.length) { rating = "Medium"; level = 2; evidence = `${pct(sum(z2))} of the site in Flood Zone 2, none in Zone 3.`; }
    else if (other.length) { rating = "In mapped zone"; level = 2; evidence = `${pct(sum(other))} of the site in a mapped flood zone whose zone is not stated.`; }
    else { rating = "None mapped"; level = 0; evidence = "No Flood Zone 2 or 3 polygon on the site. This is not a Flood Zone 1 classification."; }
    return [{ source: "Rivers and sea", rating, level, evidence: evidence + partialText(d), nation: d.nation }];
  }

  // SEPA: one group per source, classes ranked High, Medium, Low likelihood.
  function sepaRows(d) {
    const map = { River: "Rivers", Coastal: "Sea", "Surface water": "Surface water" };
    if (failed(d)) return Object.values(map).map((s) => noResult(s, d));
    const names = ["High", "Medium", "Low"];
    return Object.entries(map).map(([src, source]) => {
      const g = (d.groups || []).find((x) => x.group === "Scotland: " + src);
      const rows = g ? g.rows : [];
      if (!rows.length) return { source, rating: "None mapped", level: 0, evidence: "No SEPA flood extent on the site." + partialText(d), nation: d.nation };
      const top = rows.reduce((a, r) => (r.rank < a.rank ? r : a));
      return { source, rating: names[top.rank - 1] || "In mapped extent", level: 4 - top.rank,
        evidence: rows.map((r) => `${pct(r.percent)} ${r.label.split(" (")[0].toLowerCase()}`).join(", ") + " (SEPA)." + partialText(d), nation: d.nation };
    });
  }

  function surfaceWaterRow(d) {
    if (failed(d)) return noResult("Surface water", d);
    const b = String(d.band || "");
    const rating = !d.band ? "None mapped" : /very low/i.test(b) ? "Very low" : /high/i.test(b) ? "High" : /medium/i.test(b) ? "Medium" : /low/i.test(b) ? "Low" : "In mapped extent";
    const level = { High: 3, Medium: 2, Low: 1, "Very low": 1, "In mapped extent": 2, "None mapped": 0 }[rating];
    return { source: "Surface water", rating, level, nation: d.nation,
      evidence: d.band ? `Risk band "${b}" at the site centroid only; the rest of the site was not measured.` : "No risk band mapped at the site centroid. Check the surface water map layer for the rest of the site." };
  }

  function extentRow(source, d, hitText, noneText) {
    if (failed(d)) return noResult(source, d);
    const rows = allRows(d);
    if (!rows.length) return { source, rating: "None mapped", level: 0, evidence: noneText + partialText(d), nation: d.nation };
    const share = rows.reduce((s, r) => s + r.percent, 0);
    return { source, rating: hitText, level: 2, evidence: `${pct(share)} of the site.` + partialText(d), nation: d.nation };
  }

  // Ratings from a single point check, used when the site-wide analysis has not run.
  function pointRows(res) {
    const z = res.zone, at = res.fromSite ? "the site centroid" : "the checked point";
    if (!z) return res.errors && res.errors.zone ? [{ source: "Rivers and sea", rating: "No result", level: null, evidence: "Service unavailable: " + res.errors.zone, nation: res.nation }] : [];
    if (z.kind === "england" || z.kind === "wales") {
      const t = String(z.zone || "");
      const lvl = /3/.test(t) ? 3 : /2/.test(t) ? 2 : z.kind === "wales" && z.matchedFeatures ? 2 : 0;
      return [{ source: "Rivers and sea", nation: z.kind === "england" ? "England" : "Wales", level: lvl,
        rating: lvl === 3 ? "High" : lvl === 2 ? (/2/.test(t) ? "Medium" : "In mapped zone") : "None mapped",
        evidence: (lvl ? `${t.replace("FZ", "Flood Zone ")} at ${at}.` : `No Flood Zone 2 or 3 polygon at ${at}. This is not a Flood Zone 1 classification.`) + " Point check only." }];
    }
    const map = { River: "Rivers", Coastal: "Sea", "Surface water": "Surface water" };
    return Object.entries(map).map(([src, source]) => {
      const lik = z.found[src];
      return { source, nation: "Scotland", rating: lik || "None mapped", level: lik ? { High: 3, Medium: 2, Low: 1 }[lik] : 0,
        evidence: lik ? `${lik} likelihood at ${at}. Point check only.` : `No SEPA extent at ${at}. Point check only.` };
    });
  }

  function riskBySource({ analysis, res, nation }) {
    nation = nation || (analysis && analysis.nation) || (res && res.nation) || "Unknown";
    const notAssessed = (source, why) => ({ source, rating: "Not assessed", level: null, evidence: why, nation: null });
    if (nation === "Northern Ireland") {
      return ["Rivers and sea", "Surface water", "Groundwater", "Sewers", "Reservoirs", "Historic flooding"]
        .map((s) => notAssessed(s, "Northern Ireland flood map data is not open. Check Flood Maps NI."));
    }
    let rows = [];
    const ds = (id) => analysis && analysis.datasets.find((d) => d.id === id && d.status !== "notAssessed");
    if (analysis) {
      ["ea", "nrw"].forEach((id) => { if (ds(id)) rows.push(...zoneRows(ds(id))); });
      if (ds("sepa")) rows.push(...sepaRows(ds("sepa")));
      if (ds("ea-sw")) rows.push(surfaceWaterRow(ds("ea-sw")));
      if (ds("ea-res")) rows.push(extentRow("Reservoirs", ds("ea-res"), "In flood extent", "No reservoir flood extent on the site."));
      if (ds("ea-rec")) rows.push(extentRow("Historic flooding", ds("ea-rec"), "Flooded before", "No recorded flood outline on the site. Not all past floods were mapped."));
    } else if (res) rows = pointRows(res);

    const multi = new Set(rows.map((r) => r.nation)).size > 1;
    if (multi) rows.forEach((r) => { r.source += ` (${r.nation})`; });
    const has = (s) => rows.some((r) => r.source.startsWith(s));
    const why = {
      "Rivers and sea": analysis || res ? "No flood zone result for this location." : "No check has been run.",
      "Surface water": nation === "Wales" ? "The Natural Resources Wales surface water map is not checked by this app." : analysis ? "Not checked for this location." : "Checked only by the site-wide analysis (England).",
      Groundwater: "No open national groundwater flood dataset. Check the council's Strategic Flood Risk Assessment.",
      Sewers: "Sewer flooding records are held by the water company and are not open data.",
      Reservoirs: nation === "England" || nation === "Unknown" ? (analysis ? "Not checked for this location." : "Checked only by the site-wide analysis.") : "Reservoir flood maps for this nation are not checked by this app.",
      "Historic flooding": nation === "England" || nation === "Unknown" ? (analysis ? "Not checked for this location." : "Checked only by the site-wide analysis.") : "Recorded flood outlines for this nation are not checked by this app.",
    };
    const riversDone = has("Rivers") || has("Sea");
    if (!riversDone) rows.push(notAssessed("Rivers and sea", why["Rivers and sea"]));
    ["Surface water", "Groundwater", "Sewers", "Reservoirs", "Historic flooding"].forEach((s) => { if (!has(s)) rows.push(notAssessed(s, why[s])); });
    const order = (r) => SOURCES.findIndex((s) => r.source.startsWith(s));
    return rows.sort((a, b) => order(a) - order(b));
  }

  // Is a full Flood Risk Assessment likely to be needed?
  // verdict: "likely" | "possible" | "unclear" | "notTriggered"
  function fraNeed({ analysis, res, site, nation, rows }) {
    nation = nation || (analysis && analysis.nation) || (res && res.nation) || "Unknown";
    rows = rows || riskBySource({ analysis, res, nation });
    const hectares = site && site.measured ? site.measured.hectares : null;
    const name = nation === "Wales" ? "Flood Consequences Assessment (FCA)" : "site-specific Flood Risk Assessment (FRA)";
    const likely = [], possible = [], unclear = [];
    const r = (s) => rows.filter((x) => x.source.startsWith(s));
    const lvl = (s, min) => r(s).some((x) => x.level != null && x.level >= min);

    if (nation === "Northern Ireland") {
      return { verdict: "unclear", headline: "Cannot tell from this check: Northern Ireland is not covered.", name, reasons: ["Flood map data for Northern Ireland is not open, so no source was checked."],
        actions: ["Check the site on Flood Maps NI and ask DfI Rivers whether a Flood Risk Assessment or Drainage Assessment is needed."], links: [LINKS.floodMapsNI] };
    }
    if (nation === "Scotland") {
      if (lvl("Rivers", 2) || lvl("Sea", 2)) likely.push("Part of the site is in a SEPA medium or high likelihood river or coastal flood extent (1 in 200 a year or more often). SEPA expects an FRA for development in or next to this extent.");
      else if (lvl("Rivers", 1) || lvl("Sea", 1)) possible.push("Part of the site is in a SEPA low likelihood (1 in 1,000 a year) extent. An FRA is usually needed for the most vulnerable uses, such as care homes, and for sites next to the 1 in 200 extent.");
      if (lvl("Surface water", 2)) possible.push("SEPA maps surface water flooding on the site. The council may ask for an FRA or a drainage assessment.");
    } else {
      if (lvl("Rivers and sea", 2)) likely.push(nation === "Wales"
        ? "Part of the site is in Flood Zone 2 or 3 on the Flood Map for Planning. TAN15 asks for a Flood Consequences Assessment there."
        : "Part of the site is in Flood Zone 2 or 3. GOV.UK requires a site-specific FRA for development in these zones.");
      if (nation !== "Wales" && hectares != null && hectares >= 1) likely.push(`The site is ${hectares.toFixed(2)} ha. In England an FRA is required for any site of 1 ha or more, even in Flood Zone 1.`);
      if (lvl("Surface water", 1)) possible.push("A surface water risk band is mapped at the site centroid. In England an FRA is also needed in Flood Zone 1 where a site is affected by other sources, such as surface water.");
      if (lvl("Reservoirs", 1)) possible.push("Part of the site is in a reservoir flood extent, which counts as another source of flooding.");
      if (lvl("Historic flooding", 1)) possible.push("Part of the site has flooded before (recorded flood outline).");
    }
    rows.filter((x) => x.rating === "No result" && /Rivers|Sea/.test(x.source)).forEach((x) => unclear.push(`${x.source}: ${x.evidence}`));
    if (!analysis && site && site.features && site.features.length) unclear.push("The site-wide analysis was not run, so only the centroid was checked.");
    if (rows.some((x) => /Partial data/.test(x.evidence || ""))) unclear.push("Some data was only partly returned.");

    let verdict, headline;
    if (likely.length) { verdict = "likely"; headline = `A full ${name} is likely to be needed.`; }
    else if (possible.length) { verdict = "possible"; headline = `A full ${name} may be needed.`; }
    else if (unclear.length) { verdict = "unclear"; headline = "Cannot tell from this check: some data is missing."; }
    else { verdict = "notTriggered"; headline = "The checks made here did not trigger a full assessment."; }

    const actions = [];
    if (verdict === "likely" || verdict === "possible") actions.push(`Commission a ${name} from a competent professional before applying for planning permission.`);
    if (nation === "England" || nation === "Unknown") {
      if (verdict === "likely") actions.push("Request detailed flood data (Product 4) from the Environment Agency; it aims to reply within 20 working days.");
      actions.push("Confirm the flood zone on the official Flood Map for Planning and keep a copy with the application.");
      actions.push("Check the council's Strategic Flood Risk Assessment for critical drainage areas, groundwater and future flood risk, which this check does not cover.");
    } else if (nation === "Wales") {
      actions.push("Confirm the zone on the Natural Resources Wales Flood Map for Planning, including any TAN15 Defended Zones.");
      actions.push("Check the council's Strategic Flood Consequences Assessment for local sources of flooding.");
    } else if (nation === "Scotland") {
      actions.push("Check SEPA's flood maps and the council's flood risk guidance, and ask the council's flood team early.");
    }
    if (verdict === "notTriggered") actions.push("Ask the local planning authority to confirm that no assessment is needed: it makes the final decision.");
    if (lvl("Rivers", 2) || lvl("Sea", 2) || lvl("Rivers and sea", 2)) actions.push("Sign up for flood warnings for the site (Floodline in England, Wales and Scotland).");

    const reasons = [...likely, ...possible, ...unclear];
    if (!reasons.length) reasons.push("No mapped flood zone, extent or risk band was found by the checks made, and the site is below the size trigger.");
    const links = nation === "Wales" ? [LINKS.fmfpWales, LINKS.tan15] : nation === "Scotland" ? [LINKS.sepaPlanning] : [LINKS.fraEngland, LINKS.mapEngland];
    return { verdict, headline, name, reasons, actions, links };
  }

  // One paragraph on future (climate change) risk for the nation.
  function climateNote(nation) {
    if (nation === "Wales") return { text: "Future risk: the Natural Resources Wales Flood Map for Planning already includes the effects of climate change over the next century. A full Flood Consequences Assessment must still test the design flood with the current climate change allowances for the development's lifetime.", link: LINKS.fmfpWales };
    if (nation === "Scotland") return { text: "Future risk: the SEPA flood extents checked here show present-day likelihood. SEPA also publishes future flood maps, which were not checked. A full FRA must add SEPA's climate change allowances for the development's lifetime.", link: LINKS.sepaPlanning };
    if (nation === "Northern Ireland") return { text: "Future risk: a full Flood Risk Assessment must add the climate change allowances set by DfI Rivers.", link: LINKS.floodMapsNI };
    return { text: "Future risk: the Flood Zones show present-day risk and do not include climate change. The Environment Agency's 'Flood Zones plus climate change' map shows how they could grow over the next century; it was not checked here. A full FRA must add the official climate change allowances for the development's lifetime (usually 100 years for homes).", link: LINKS.climateEngland };
  }

  FRC.assessment = { LINKS, riskBySource, fraNeed, climateNote };
  if (typeof module !== "undefined" && module.exports) module.exports = FRC.assessment;
})(typeof window !== "undefined" ? window : globalThis);
