// PDF screening report (jsPDF, with map images drawn from the map; see FRC.map.snapshot).
// Follows the spec's report structure, one section per page:
//   1 Executive summary            5 Flood-zone spatial intersection
//   2 Site location plan           6 Additional flood information
//   3 Site boundary and measurements 7 Flood warnings and river gauges
//   4 Flood-zone assessment        8 Data sources, methodology and limitations
// Page one also carries a document control box, a risk rating for each
// source of flooding and whether a full Flood Risk Assessment is likely to be
// needed (see js/reporting/assessment.js).
// Findings are kept apart from missing or unavailable data: every dataset
// shows its status, and a section with nothing to report says why.
(function (root) {
  "use strict";
  const FRC = (root.FRC = root.FRC || {});
  const { fmtDate, fmtNum } = FRC.util;

  const INK = [20, 35, 43], MUTED = [85, 112, 121], ACCENT = [11, 110, 138], LINE = [213, 224, 227], HEAD_BG = [234, 242, 244];

  // Public sources, in the order they are listed in section 8.
  const SOURCES = [
    ["Postcode and location", "postcodes.io (ONS Postcode Directory, OS Open Names)", "https://api.postcodes.io"],
    ["Flood zones, England", "Environment Agency Flood Map for Planning, Flood Zones 2 and 3 (rivers and sea)", "https://environment.data.gov.uk/spatialdata/flood-map-for-planning-flood-zones"],
    ["Long-term risk, England", "Environment Agency Risk of Flooding from Rivers and Sea (NaFRA2)", "https://environment.data.gov.uk/spatialdata/nafra2-risk-of-flooding-from-rivers-and-sea"],
    ["Surface water, England", "Environment Agency Risk of Flooding from Surface Water (NaFRA2)", "https://environment.data.gov.uk/spatialdata/nafra2-risk-of-flooding-from-surface-water"],
    ["Reservoirs, England", "Environment Agency Reservoir Flood Extents, wet day", "https://environment.data.gov.uk/spatialdata/reservoir-flood-extents-wet-day"],
    ["Historic floods, England", "Environment Agency Recorded Flood Outlines", "https://environment.data.gov.uk/spatialdata/recorded-flood-outlines"],
    ["Warnings and gauges, England", "Environment Agency real-time flood monitoring API (Beta)", "https://environment.data.gov.uk/flood-monitoring"],
    ["Flood zones, Wales", "Natural Resources Wales Flood Map for Planning (rivers and sea), DataMapWales", "https://datamap.gov.wales"],
    ["Flood maps, Scotland", "SEPA Flood Maps (river, surface water and coastal)", "https://map.sepa.org.uk/server/rest/services/Open/Flood_Maps/MapServer"],
    ["Base map", "OpenStreetMap contributors", "https://www.openstreetmap.org/copyright"],
  ];

  const DISCLAIMER = "This report provides preliminary flood risk screening information built from public datasets at the time shown. It is not a substitute for a site-specific Flood Risk Assessment prepared by a competent professional, and it is not a planning submission. A missing map feature, unavailable service or empty query result must not be read as proof that a site is free from flood risk, or as a Flood Zone 1 classification. Verify findings against the current official mapping. Do not use this report for emergency or safety-critical decisions.";

  // The nation's flood-zone map layer, as keyed in FRC.mapLayers.layers.
  const ZONE_LAYER = { England: "ez", Wales: "w", Scotland: "s" };

  FRC.pdfReport = {
    SOURCES,

    // res: last point check (may be null); site: { features, measured } (may be empty);
    // analysis: site-wide analysis (may be null);
    // opts: { company, logo, siteName, ref, analyst, checkedBy, version, notes, sections: { location, site, zone, intersect, other, live, maps } }
    async build(res, site, analysis, opts) {
      const { jsPDF } = root.jspdf;
      const doc = new jsPDF({ unit: "mm", format: "a4" });
      const W = 210, M = 16, CW = W - 2 * M, TOP = 24, BOTTOM = 278;
      const S = opts.sections;
      const hasSite = Boolean(site && site.features.length && site.measured);
      const p = (res && res.place) || {};
      const nation = (res && res.nation) || (analysis && analysis.nation) || "Unknown";
      const when = new Date();
      const siteLabel = opts.siteName || p.postcode || (hasSite ? "Unnamed site" : "Checked location");
      let y = TOP;

      // ---------- Layout helpers ----------
      const color = (c) => doc.setTextColor(c[0], c[1], c[2]);
      const ensure = (h) => { if (y + h > BOTTOM) { doc.addPage(); y = TOP; } };
      const newPage = () => { doc.addPage(); y = TOP; };
      const h1 = (t) => { doc.setFont("helvetica", "bold"); doc.setFontSize(18); color(INK); doc.text(t, M, y + 6); y += 11; };
      const section = (n, t) => {
        if (doc.getNumberOfPages() > 1 || y > TOP) newPage();
        doc.setFont("helvetica", "bold"); doc.setFontSize(9); color(MUTED); doc.text(`SECTION ${n}`, M, y + 3);
        doc.setFontSize(15); color(ACCENT); doc.text(t, M, y + 10); color(INK); y += 16;
      };
      const h3 = (t) => { ensure(12); y += 2; doc.setFont("helvetica", "bold"); doc.setFontSize(11); color(INK); const l = doc.splitTextToSize(t, CW); doc.text(l, M, y + 4); y += l.length * 5 + 2; };
      const para = (t, size = 10, c = INK) => {
        doc.setFont("helvetica", "normal"); doc.setFontSize(size); color(c);
        const lines = doc.splitTextToSize(String(t), CW); const lh = size * 0.45;
        ensure(lines.length * lh + 2); doc.text(lines, M, y + 4); y += lines.length * lh + 2; color(INK);
      };
      const note = (t) => para(t, 8.5, MUTED);
      const kv = (k, v) => {
        doc.setFontSize(10);
        doc.setFont("helvetica", "bold"); const keys = doc.splitTextToSize(String(k), 50);
        doc.setFont("helvetica", "normal"); const lines = doc.splitTextToSize(String(v), CW - 54);
        const n = Math.max(1, keys.length, lines.length); ensure(n * 4.6 + 1);
        doc.setFont("helvetica", "bold"); doc.text(keys, M, y + 4);
        doc.setFont("helvetica", "normal"); doc.text(lines, M + 54, y + 4);
        y += n * 4.6 + 1;
      };
      // Simple table: cols = [{ title, width (mm), align }], rows = arrays of strings.
      const table = (cols, rows, { size = 9 } = {}) => {
        const pad = 1.6, lh = size * 0.42;
        const drawRow = (cells, head) => {
          doc.setFont("helvetica", head ? "bold" : "normal"); doc.setFontSize(size);
          const wrapped = cells.map((c, i) => doc.splitTextToSize(String(c == null ? "" : c), cols[i].width - 2 * pad));
          const h = Math.max(...wrapped.map((w) => w.length)) * lh + 2 * pad;
          if (y + h > BOTTOM) { newPage(); if (!head) drawRow(cols.map((c) => c.title), true); doc.setFont("helvetica", head ? "bold" : "normal"); doc.setFontSize(size); }
          let x = M;
          if (head) { doc.setFillColor(HEAD_BG[0], HEAD_BG[1], HEAD_BG[2]); doc.rect(M, y, CW, h, "F"); }
          wrapped.forEach((w, i) => {
            const c = cols[i];
            if (c.align === "right") doc.text(w, x + c.width - pad, y + pad + lh * 0.8, { align: "right" });
            else doc.text(w, x + pad, y + pad + lh * 0.8);
            x += c.width;
          });
          y += h;
          doc.setDrawColor(LINE[0], LINE[1], LINE[2]); doc.setLineWidth(0.2); doc.line(M, y, M + CW, y);
        };
        ensure(12);
        drawRow(cols.map((c) => c.title), true);
        rows.forEach((r) => drawRow(r, false));
        y += 3;
      };
      const mapImage = async (snap, caption) => {
        if (!S.maps) return;
        try {
          const shot = await FRC.map.snapshot(snap);
          let w = CW, h = (CW * shot.h) / shot.w;
          if (h > 120) { w = (w * 120) / h; h = 120; }
          ensure(h + 8);
          doc.addImage(shot.img, "JPEG", M + (CW - w) / 2, y, w, h);
          doc.setDrawColor(LINE[0], LINE[1], LINE[2]); doc.rect(M + (CW - w) / 2, y, w, h);
          y += h + 2; note(caption);
        } catch (e) { note("The map image could not be captured in this browser: " + e.message); }
      };
      const notAssessed = (why) => { kv("Status", "Not assessed"); note(why); };
      const pct = (v) => v.toFixed(1) + "%";

      // ---------- Data used by several sections ----------
      const siteBounds = hasSite ? L.geoJSON({ type: "FeatureCollection", features: site.features }).getBounds() : null;
      const centre = hasSite ? [site.measured.centroidWGS[1], site.measured.centroidWGS[0]] : res ? [res.lat, res.lon] : null;
      const datasets = analysis ? analysis.datasets : [];
      const zoneSets = datasets.filter((d) => d.primary);
      const otherSets = datasets.filter((d) => !d.primary);

      // ---------- 1. Executive summary ----------
      if (opts.logo) {
        try {
          const props = doc.getImageProperties(opts.logo);
          const h = 14, w = Math.min(60, (h * props.width) / props.height);
          doc.addImage(opts.logo, props.fileType || "PNG", M, y, w, h); y += h + 4;
        } catch { /* an unreadable logo is left out */ }
      }
      if (opts.company) { doc.setFont("helvetica", "bold"); doc.setFontSize(11); color(MUTED); doc.text(opts.company, M, y + 4); y += 7; }
      h1("Flood risk screening report");
      kv("Site", siteLabel);
      kv("Location", [p.admin_ward, p.admin_district, nation !== "Unknown" ? nation : null].filter(Boolean).join(", ") || "-");
      if (p.postcode) kv("Postcode", p.postcode);
      if (centre) kv("Coordinates", `${centre[0].toFixed(6)}, ${centre[1].toFixed(6)}${hasSite ? " (site centroid)" : ""}`);
      if (opts.ref) kv("Report reference", opts.ref);
      y += 1;

      // Document control: version, date, who prepared and who checked it.
      h3("Document control");
      table([{ title: "Version", width: 22 }, { title: "Date", width: 42 }, { title: "Prepared by", width: 59 }, { title: "Checked by", width: CW - 123 }],
        [[opts.version || "-", fmtDate(when), opts.analyst || "Not recorded", opts.checkedBy || "Not checked"]]);
      if (!opts.checkedBy) note("This report has not been checked by a second person.");

      doc.setFont("helvetica", "bold"); doc.setFontSize(13); color(ACCENT); doc.text("Executive summary", M, y + 5); color(INK); y += 9;
      if (hasSite) para(`The site covers ${fmtNum(site.measured.area, 0)} m² (${fmtNum(site.measured.hectares, 2)} ha) in ${site.measured.parcels.length} parcel${site.measured.parcels.length > 1 ? "s" : ""}, with a perimeter of ${fmtNum(site.measured.perimeter, 0)} m.`);
      else para("No site boundary was defined. The results below are single-point checks at the location shown.");

      // Risk by source of flooding, then the next step.
      const A = FRC.assessment;
      const risk = A.riskBySource({ analysis, res, nation });
      h3("Risk by source of flooding");
      table([{ title: "Source", width: 40 }, { title: "Rating", width: 30 }, { title: "Evidence", width: CW - 70 }], risk.map((r) => [r.source, r.rating, r.evidence]));
      note("Ratings follow each agency's own classes: High is Flood Zone 3 or a high likelihood band, Medium is Flood Zone 2 or a medium band. None mapped means no mapped feature was found; it is not a confirmed low risk.");
      const fra = A.fraNeed({ analysis, res, site, nation, rows: risk });
      h3("Is a full Flood Risk Assessment needed?");
      { // Answer in a shaded box so it stands out.
        doc.setFont("helvetica", "bold"); doc.setFontSize(10.5);
        const lines = doc.splitTextToSize(fra.headline, CW - 6); const h = lines.length * 4.8 + 4;
        ensure(h + 2); doc.setFillColor(HEAD_BG[0], HEAD_BG[1], HEAD_BG[2]); doc.rect(M, y, CW, h, "F");
        color(INK); doc.text(lines, M + 3, y + 5.4); y += h + 2;
      }
      fra.reasons.forEach((t) => para("•  " + t, 9.5));
      doc.setFont("helvetica", "bold"); doc.setFontSize(9.5); ensure(6); doc.text("Next steps", M, y + 4); y += 6;
      fra.actions.forEach((t, i) => para(`${i + 1}.  ${t}`, 9.5));
      note("Guidance: " + fra.links.join("  ·  ") + ". This is a screening indication. The local planning authority decides whether an assessment is needed.");
      const climate = A.climateNote(nation);
      note(climate.text + " " + climate.link);

      // Findings at a glance: one row per dataset, finding and status kept apart.
      const glance = [];
      zoneSets.concat(otherSets).forEach((d) => {
        if (d.status === "notAssessed") return;
        let finding = d.summary || "";
        if (!finding && d.groups && d.groups.length) finding = d.groups.map((g) => (d.groups.length > 1 || g.group !== d.nation ? g.group + ": " : "") + FRC.results.groupFinding(g, d.noneText)).join(" ");
        if (!finding) finding = d.status === "unavailable" || d.status === "error" ? "No result: " + (d.error || d.statusText) : "-";
        glance.push([d.name.split(" (")[0], finding, d.statusText]);
      });
      if (res) {
        const z = FRC.results.zoneSummary(res);
        glance.push([`Flood zone at ${res.fromSite ? "site centroid" : "point"}`, z.pill[1], FRC.results.dataStatus(res)[0].status[1]]);
        if (res.band || res.errors.band) glance.push(["Long-term risk, rivers and sea", res.errors.band ? "No result" : res.band.band || "No band mapped", res.errors.band ? "Service unavailable" : res.band.band ? "Data retrieved" : "No mapped feature identified"]);
        if (res.live || res.errors.live) glance.push([`Flood warnings within ${res.dist} km`, res.errors.live ? "No result" : res.live.length ? `${res.live.length} in force` : "None in force", res.errors.live ? "Service unavailable" : "Data retrieved"]);
      }
      if (!analysis && hasSite) glance.unshift(["Site-wide flood analysis", "Not run for this report", "Not assessed"]);
      if (glance.length) { h3("Findings at a glance"); table([{ title: "Dataset", width: 52 }, { title: "Finding", width: 88 }, { title: "Status", width: CW - 140 }], glance); }
      const skipped = datasets.filter((d) => d.status === "notAssessed");
      if (skipped.length) note("Not assessed: " + skipped.map((d) => `${d.name.split(" (")[0]} (${d.notes[0] || "not applicable"})`).join("; ") + ".");
      if (analysis) analysis.notes.forEach((n) => note(n));
      if (opts.notes) { h3("Notes"); para(opts.notes); }
      y += 2; note(DISCLAIMER);

      // ---------- 2. Site location plan ----------
      if (S.location && centre) {
        section(2, "Site location plan");
        kv("Site", siteLabel);
        kv("Location", [p.admin_ward, p.admin_district].filter(Boolean).join(", ") || "-");
        kv("Country", nation);
        if (p.postcode) kv("Postcode", p.postcode);
        kv("Coordinates (WGS84)", `${centre[0].toFixed(6)}, ${centre[1].toFixed(6)}`);
        if (hasSite) kv("Grid reference (BNG)", `E ${fmtNum(site.measured.centroidBNG[0], 1)}, N ${fmtNum(site.measured.centroidBNG[1], 1)}`);
        else if (p.eastings) kv("Grid reference (BNG)", `E ${p.eastings}, N ${p.northings}`);
        y += 2;
        await mapImage({ view: { center: centre, zoom: 14 } }, `Site location${hasSite ? " (boundary outlined)" : " (marker)"}. Base map © OpenStreetMap contributors.`);
      }

      // ---------- 3. Site boundary and measurements ----------
      if (S.site) {
        section(3, "Site boundary and measurements");
        if (!hasSite) notAssessed("No site boundary was drawn or imported, so no measurements were made.");
        else {
          const m = site.measured;
          kv("Site area", `${fmtNum(m.area, 0)} m²  ·  ${fmtNum(m.hectares, 2)} ha  ·  ${fmtNum(m.acres, 2)} acres`);
          kv("Perimeter", `${fmtNum(m.perimeter, 1)} m`);
          kv("Parcels", String(m.parcels.length) + (m.holes ? ` (with ${m.holes} hole${m.holes > 1 ? "s" : ""})` : ""));
          kv("Centroid (WGS84)", `${m.centroidWGS[1].toFixed(6)}, ${m.centroidWGS[0].toFixed(6)}`);
          kv("Centroid (BNG)", `E ${fmtNum(m.centroidBNG[0], 1)}, N ${fmtNum(m.centroidBNG[1], 1)}`);
          if (m.parcels.length > 1) { y += 1; table([{ title: "Parcel", width: 70 }, { title: "Area m²", width: 38, align: "right" }, { title: "Hectares", width: 32, align: "right" }, { title: "Perimeter m", width: CW - 140, align: "right" }], m.parcels.map((pc) => [pc.name, fmtNum(pc.area, 0), fmtNum(pc.area / 10000, 2), fmtNum(pc.perimeter, 1)])); }
          site.warnings.forEach((w) => note("Note: " + w));
          await mapImage({ view: { bounds: siteBounds } }, "Site boundary. Base map © OpenStreetMap contributors.");
          note("Measured on the British National Grid (EPSG:27700) from the boundary's corner points. Grid areas can differ from ground areas by up to about 0.1% depending on location.");
        }
      }

      // ---------- 4. Flood-zone assessment ----------
      if (S.zone) {
        section(4, "Flood-zone assessment");
        if (nation === "Northern Ireland") notAssessed("Northern Ireland flood map data is not open. Check the official Flood Maps NI viewer.");
        if (res) {
          const z = FRC.results.zoneSummary(res);
          h3(res.fromSite ? "Flood zone at the site centroid" : "Flood zone at the checked point");
          kv("Result", z.pill[1]); kv("Status", FRC.results.dataStatus(res)[0].status[1] + (res.zone && res.zone.retrieved ? `  (retrieved ${fmtDate(res.zone.retrieved)})` : ""));
          para(z.text, 9.5);
          const cn = FRC.assessment.climateNote(nation); note(cn.text);
          if (res.band || res.errors.band) {
            h3("Long-term risk, rivers and sea (England)");
            if (res.errors.band) { kv("Status", "Service unavailable"); note(res.errors.band); }
            else if (!res.band.band) { kv("Result", "No band mapped"); note("No risk band was returned at this point. This is not a confirmed very low result: the service's point answers are not reliable, so check the Environment Agency's long-term flood risk map."); }
            else { kv("Result", res.band.band); kv("Status", `Data retrieved  (retrieved ${fmtDate(res.band.retrieved)})`); note("Environment Agency Risk of Flooding from Rivers and Sea, which takes flood defences into account."); }
          }
        } else notAssessed("No point check was run.");
        if (zoneSets.some((d) => d.status !== "notAssessed")) {
          h3("Site summary");
          zoneSets.filter((d) => d.status !== "notAssessed").forEach((d) => (d.groups || []).forEach((g) => para(`${g.group}: ${FRC.results.groupFinding(g, d.noneText)}`, 9.5)));
          note("Areas and percentages are set out in section 5.");
        }
        const zoneKey = ZONE_LAYER[nation];
        if (hasSite && zoneKey) await mapImage({ view: { bounds: siteBounds }, overlays: [zoneKey], analysis: true },
          `Flood-zone map: ${nation === "Scotland" ? "SEPA river flood extents" : "Flood Map for Planning"} with the mapped parts of the site shaded (darkest for the most severe class). Contains ${nation === "England" ? "Environment Agency" : nation === "Wales" ? "Natural Resources Wales" : "SEPA"} data. Base map © OpenStreetMap contributors.`);
        else if (centre && zoneKey) await mapImage({ view: { center: centre, zoom: 15 }, overlays: [zoneKey] }, "Flood-zone map around the checked point. Base map © OpenStreetMap contributors.");
      }

      // ---------- 5. Flood-zone spatial intersection ----------
      if (S.intersect) {
        section(5, "Flood-zone spatial intersection");
        if (!hasSite) notAssessed("No site boundary was defined, so no areas could be measured.");
        else if (!analysis) notAssessed("The site-wide analysis was not run. Press Analyse site before building the report.");
        else {
          zoneSets.forEach((d) => {
            h3(d.name);
            kv("Status", d.statusText + (d.retrieved ? `  (retrieved ${fmtDate(d.retrieved)})` : ""));
            if (d.status === "notAssessed") { note(d.notes[0] || ""); return; }
            if (d.error) note("Reason: " + d.error);
            (d.groups || []).forEach((g) => {
              if (d.groups.length > 1 || g.group !== d.nation) { doc.setFont("helvetica", "bold"); doc.setFontSize(9.5); ensure(6); doc.text(g.group, M, y + 4); y += 6; }
              table([{ title: "Classification", width: 100 }, { title: "Area m²", width: 40, align: "right" }, { title: "% of site", width: CW - 140, align: "right" }],
                [...g.rows.map((r) => [r.label, fmtNum(r.area, 0), pct(r.percent)]), [d.noneText, fmtNum(g.remainingArea, 0), pct(g.remainingPercent)], ["Total site", fmtNum(g.siteArea, 0), "100.0%"]]);
            });
            d.notes.forEach((n) => note(n));
          });
          note("Reading the classes: Flood Zone 3 is land with a 1% or greater chance of river flooding each year (1 in 100), or 0.5% or greater from the sea (1 in 200). Flood Zone 2 is between 0.1% and 1% a year from rivers (1 in 1,000 to 1 in 100). SEPA bands: high 10% a year (1 in 10), medium 0.5% (1 in 200), low 0.1% (1 in 1,000).");
          note("Method: the site boundary and each dataset's polygons were converted to British National Grid (EPSG:27700) and intersected. Polygons of the same class were merged so overlaps count once; where classes overlap, the area is counted once in the more severe class. Land with no mapped polygon is reported as such and is not classified as Flood Zone 1.");
        }
      }

      // ---------- 6. Additional flood information ----------
      if (S.other) {
        section(6, "Additional flood information");
        if (!analysis) notAssessed(hasSite ? "The site-wide analysis was not run. Press Analyse site before building the report." : "No site boundary was defined.");
        else {
          otherSets.forEach((d) => {
            h3(d.name);
            kv("Status", d.statusText + (d.retrieved ? `  (retrieved ${fmtDate(d.retrieved)})` : ""));
            if (d.status === "notAssessed") { note(d.notes[0] || ""); return; }
            if (d.error) note("Reason: " + d.error);
            if (d.summary) kv("Finding", d.summary);
            (d.groups || []).forEach((g) => table([{ title: "Classification", width: 100 }, { title: "Area m²", width: 40, align: "right" }, { title: "% of site", width: CW - 140, align: "right" }],
              [...g.rows.map((r) => [r.label, fmtNum(r.area, 0), pct(r.percent)]), [d.noneText, fmtNum(g.remainingArea, 0), pct(g.remainingPercent)], ["Total site", fmtNum(g.siteArea, 0), "100.0%"]]));
            d.notes.forEach((n) => note(n));
          });
          if (nation === "Scotland") note("For Scotland, surface water and coastal flood extents are part of the SEPA analysis in section 5.");
        }
      }

      // ---------- 7. Flood warnings and river gauges ----------
      if (S.live) {
        section(7, "Flood warnings and river gauges");
        if (!res) notAssessed("No point check was run.");
        else if (nation !== "England" && nation !== "Unknown") notAssessed("Live flood warnings and river gauge readings are available for England only.");
        else {
          note(`Checked within ${res.dist} km of ${res.fromSite ? "the site centroid" : "the checked point"}.`);
          h3("Flood warnings and alerts");
          if (res.errors.live) { kv("Status", "Service unavailable"); note(res.errors.live); }
          else if (!res.live) kv("Status", "Not assessed");
          else {
            kv("Status", `Data retrieved  (retrieved ${fmtDate(res.liveAt)})`);
            if (!res.live.length) kv("Finding", "No flood warnings or alerts in force.");
            else table([{ title: "Severity", width: 34 }, { title: "Area", width: 96 }, { title: "Raised", width: CW - 130 }], res.live.map((w) => [w.severity, w.description, fmtDate(w.raised)]));
          }
          h3("River gauges");
          if (res.errors.gauges) { kv("Status", "Service unavailable"); note(res.errors.gauges); }
          else if (!res.gauges) kv("Status", "Not assessed");
          else {
            kv("Status", `Data retrieved  (retrieved ${fmtDate(res.liveAt)})`);
            if (!res.gauges.length) kv("Finding", "No river level gauges in this radius.");
            else table([{ title: "Gauge", width: 66 }, { title: "Distance", width: 24, align: "right" }, { title: "Latest level", width: 28, align: "right" }, { title: "Reading time", width: CW - 118 }],
              res.gauges.map((g) => [g.name + (g.river ? ", " + g.river : ""), g.km.toFixed(1) + " km", g.value != null ? g.value.toFixed(2) + " " + (g.unit || "m") : "-", g.value != null ? fmtDate(g.time) : "No recent reading"]));
          }
          note("Live data changes quickly. Check the Environment Agency's flood warning service for the current position.");
        }
      }

      // ---------- 8. Data sources, methodology and limitations (always) ----------
      section(8, "Data sources, methodology and limitations");
      h3("Data status and retrieval times");
      const status = [];
      datasets.forEach((d) => status.push([d.name.split(" (")[0], d.statusText, d.retrieved ? fmtDate(d.retrieved) : "-"]));
      if (res) FRC.results.dataStatus(res).forEach((r) => status.push([r.name + (res.fromSite ? " (site centroid)" : " (point)"), r.status[1], r.when ? fmtDate(r.when) : "-"]));
      if (status.length) table([{ title: "Dataset", width: 82 }, { title: "Status", width: 54 }, { title: "Retrieved", width: CW - 136 }], status);
      else note("No data was retrieved.");
      h3("Data sources");
      table([{ title: "Data", width: 40 }, { title: "Source", width: 70 }, { title: "Reference", width: CW - 110 }], SOURCES.map((s) => s));
      note("Contains Environment Agency information © Environment Agency and database right. Contains Natural Resources Wales information © Natural Resources Wales and Database Right. All rights Reserved. Contains SEPA data © Scottish Environment Protection Agency. All used under the Open Government Licence v3.0. This uses Environment Agency flood and river level data from the real-time data API (Beta). Map data © OpenStreetMap contributors.");
      h3("Methodology");
      para("The site boundary is validated and measured on the British National Grid (EPSG:27700). The site's country is taken from its centroid, and the flood datasets for that country are queried for the site's extent. Each dataset's polygons are converted to British National Grid and intersected with the site. Polygons of the same class are merged so overlaps count once, and classes are made exclusive from most to least severe, so land in two classes is counted once, in the more severe. Each agency's own classification is kept: Flood Zones in England and Wales, likelihood bands in Scotland. Datasets published only as map images (surface water in England, the long-term risk band) and the live data are checked at a single point.", 9.5);
      h3("Limitations");
      [
        "The flood zone services publish Zones 2 and 3 only. Land with no mapped polygon is not classified as Flood Zone 1.",
        "A site that crosses a national border is analysed only against the datasets for its centroid's country.",
        "Very large sites can reach a service's result limit; this is reported as Partial coverage.",
        "The British National Grid conversion uses a standard 7-parameter shift, accurate to a few metres.",
        "Groundwater flooding is not assessed: there is no open national dataset.",
        "Sewer flooding is not assessed: records are held by the water companies and are not open.",
        "Flood levels, ground levels and floor levels (mAOD), flood defences, residual risk, safe access and drainage are not assessed. A full Flood Risk Assessment covers them.",
        "Results show present-day risk unless stated. Climate change allowances are not applied.",
        "Northern Ireland is not covered.",
      ].forEach((t) => para("•  " + t, 9.5));
      note(`Generated with Flood Risk Checker version ${root.FRC_VERSION || "unknown"}, using only free, open data under the licences above.`);
      h3("Disclaimer");
      para(DISCLAIMER, 9.5);

      // ---------- Header and footer on every page ----------
      const pages = doc.getNumberOfPages();
      for (let i = 1; i <= pages; i++) {
        doc.setPage(i);
        doc.setFont("helvetica", "normal"); doc.setFontSize(8); color(MUTED);
        if (i > 1) {
          doc.text([opts.company, "Flood risk screening report", siteLabel].filter(Boolean).join("  ·  "), M, 12);
          const refText = [opts.ref, opts.version && "Version " + opts.version].filter(Boolean).join("  ·  ");
          if (refText) doc.text(refText, W - M, 12, { align: "right" });
          doc.setDrawColor(LINE[0], LINE[1], LINE[2]); doc.line(M, 15, W - M, 15);
        }
        doc.text(`Preliminary screening, not a Flood Risk Assessment  ·  generated ${fmtDate(when)}`, M, 290);
        doc.text(`Page ${i} of ${pages}`, W - M, 290, { align: "right" });
      }
      color(INK);
      const base = (opts.siteName || p.postcode || "site").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "site";
      const pad = (n) => String(n).padStart(2, "0");
      const day = `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}`; // local date, as printed in the report
      doc.save(`flood-report-${base}-${day}.pdf`);
    },
  };
})(typeof window !== "undefined" ? window : globalThis);
