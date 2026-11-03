// PDF screening report (jsPDF, with map images drawn from the map; see FRC.map.snapshot).
// A clean, rounded layout with plenty of white space:
//   Cover         logo, title, site details, document control, site map
//   Contents
//   1 Summary     the answer first: risk by source, is a full FRA needed, next steps
//   2 The site    location, measurements, boundary map
//   3 Flood risk by source: one page per source of flooding, each with its own
//                 map showing only that agency's layer, a plain-language answer,
//                 a technical box for engineers and a link to the official map
//   4 Flood warnings and river gauges (England)
//   5 Data, method and limitations: sources, data status, data gaps,
//                 method, limitations, glossary, disclaimer
// Findings are kept apart from missing or unavailable data: a source with
// nothing mapped is never called safe, and never Flood Zone 1.
(function (root) {
  "use strict";
  const FRC = (root.FRC = root.FRC || {});
  const { fmtDate, fmtNum } = FRC.util;

  const INK = [28, 36, 41], MUTED = [104, 116, 122], LINE = [226, 231, 234], CARD = [245, 247, 248], WHITE = [255, 255, 255];
  const DEFAULT_ACCENT = "#0b6e8a";
  const hexRgb = (h) => { const m = /^#?([0-9a-f]{6})$/i.exec(String(h || "")); const n = parseInt(m ? m[1] : DEFAULT_ACCENT.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const tint = (c, t) => c.map((v) => Math.round(v + (255 - v) * t));

  // Rating colours: strong for a mapped risk, grey where nothing is known.
  const RATING = {
    High: [192, 57, 43], Medium: [214, 120, 20], Low: [196, 160, 0], "Very low": [52, 140, 90],
    "In flood extent": [214, 120, 20], "Flooded before": [214, 120, 20], "In mapped zone": [214, 120, 20], "In mapped extent": [214, 120, 20],
    "None mapped": [120, 132, 138], "Not assessed": [170, 178, 182], "No result": [150, 60, 60], "See the map": [120, 132, 138],
  };
  // What each rating means, in plain words.
  const MEANS = {
    High: "Part of the site is in the highest class mapped for this source. Flooding from this source is a real possibility and needs a closer look.",
    Medium: "Part of the site is in a medium class: flooding is less likely than in the highest class, but still possible.",
    Low: "A low chance of flooding is mapped for this source.",
    "Very low": "A very low chance of flooding is mapped for this source.",
    "In flood extent": "Part of the site is inside the mapped area for this source.",
    "In mapped zone": "Part of the site is inside a mapped flood zone.",
    "In mapped extent": "Part of the site is inside a mapped flood area.",
    "Flooded before": "Part of the site is inside an area where flooding has been recorded in the past.",
    "None mapped": "No mapped flooding from this source was found on the site. This is not the same as no risk: maps do not show every flood.",
    "No result": "The data service did not answer, so this source is unknown. Run the check again before relying on the report.",
    "Not assessed": "This source could not be checked with free, open data.",
    "See the map": "The service gave no answer at the exact point, so read the map on this page.",
  };

  const LINK = {
    ltfr: "https://www.gov.uk/check-long-term-flood-risk",
    sepaMap: "https://map.sepa.org.uk/floodmaps",
  };

  // One entry per source of flooding, per nation. layer: key in
  // FRC.mapLayers.layers; ds: dataset id in the site analysis; group: the
  // SEPA group; risk: the source name used by FRC.assessment.riskBySource.
  const CONCERNS = {
    England: [
      { id: "rivers", risk: "Rivers and sea", agency: "Environment Agency", title: "Rivers and the sea", layer: "ez", ds: "ea", shade: true,
        dataset: "Flood Map for Planning: Flood Zones 2 and 3",
        about: "The Flood Map for Planning shows land that could flood from rivers or the sea if there were no flood defences. Flood Zone 3 has the highest chance: 1 in 100 or more each year from rivers, or 1 in 200 or more from the sea. Flood Zone 2 has a lower chance, between 1 in 1,000 and 1 in 100 each year. Planning rules are based on these zones.",
        tech: "EA Flood Map for Planning, Flood Zones 2 and 3 (rivers and sea), OGC API Features. Undefended, present-day extents. Polygons intersected with the site on British National Grid (EPSG:27700); overlapping polygons counted once, in the more severe zone.",
        mapNote: "Flood Zones 2 and 3 (Environment Agency).", link: FRC.assessment && FRC.assessment.LINKS.mapEngland },
      { id: "longterm", agency: "Environment Agency", title: "Long-term risk from rivers and the sea", layer: "er", band: true,
        dataset: "Risk of Flooding from Rivers and Sea",
        about: "This map shows the chance of flooding from rivers or the sea each year, taking flood defences into account. It uses four bands: high (more than 1 in 30), medium (1 in 100 to 1 in 30), low (1 in 1,000 to 1 in 100) and very low (less than 1 in 1,000).",
        tech: "EA Risk of Flooding from Rivers and Sea (NaFRA2), WMS layer rofrs_4band. Checked at a single point (the site centroid). The service does not always answer at a point, so the map is the main evidence.",
        mapNote: "Long-term risk bands, rivers and sea (Environment Agency).", link: LINK.ltfr },
      { id: "surface", risk: "Surface water", agency: "Environment Agency", title: "Surface water (heavy rain)", layer: "sw", minZoom: 14, ds: "ea-sw",
        dataset: "Risk of Flooding from Surface Water",
        about: "Surface water flooding happens when heavy rain cannot drain away and collects on the ground. The map uses the same four bands: high, medium, low and very low.",
        tech: "EA Risk of Flooding from Surface Water (NaFRA2), WMS layer rofsw (drawn at 1:50,000 or closer). Band checked at the site centroid; the map shows the pattern across the site.",
        mapNote: "Surface water risk bands (Environment Agency).", link: LINK.ltfr },
      { id: "reservoirs", risk: "Reservoirs", agency: "Environment Agency", title: "Reservoirs", layer: "res", ds: "ea-res",
        dataset: "Reservoir Flood Extents (wet day)",
        about: "This map shows where water could go if a large reservoir failed. That is very unlikely: large reservoirs are inspected by law. It shows a worst case, on a day when rivers are already high.",
        tech: "EA Reservoir Flood Extents, wet day scenario, OGC API Features, intersected with the site.",
        mapNote: "Reservoir flood extents, wet day (Environment Agency).", link: LINK.ltfr },
      { id: "history", risk: "Historic flooding", agency: "Environment Agency", title: "Past floods", layer: "rec", ds: "ea-rec",
        dataset: "Recorded Flood Outlines",
        about: "This map shows the outlines of floods recorded in the past. Not every past flood was mapped, so a site outside these outlines may still have flooded.",
        tech: "EA Recorded Flood Outlines (from 1946), OGC API Features, intersected with the site.",
        mapNote: "Recorded flood outlines (Environment Agency).", link: "https://environment.data.gov.uk/spatialdata/recorded-flood-outlines" },
    ],
    Wales: [
      { id: "rivers", risk: "Rivers and sea", agency: "Natural Resources Wales", title: "Rivers and the sea", layer: "w", ds: "nrw", shade: true,
        dataset: "Flood Map for Planning (rivers and sea)",
        about: "The Natural Resources Wales Flood Map for Planning shows land that could flood from rivers or the sea, including the effect of climate change over the next century. Flood Zone 3 has the highest chance, Flood Zone 2 a lower one. Planning rules in Wales (TAN15) are based on these zones.",
        tech: "NRW Flood Map for Planning, rivers and sea, merged zones (DataMapWales WFS). Polygons intersected with the site on British National Grid (EPSG:27700); overlaps counted once, in the more severe zone.",
        mapNote: "Flood Map for Planning zones (Natural Resources Wales).", link: FRC.assessment && FRC.assessment.LINKS.fmfpWales },
    ],
    Scotland: [
      { id: "rivers", risk: "Rivers", agency: "SEPA", title: "Rivers", layer: "s", ds: "sepa", group: "Scotland: River",
        dataset: "Flood Maps: river flooding",
        about: "SEPA's river flood map shows land that could flood from rivers, in three likelihood bands: high (about 1 in 10 each year), medium (about 1 in 200) and low (about 1 in 1,000).",
        tech: "SEPA Flood Maps, river flooding layers 0 to 2 (ArcGIS MapServer query), intersected with the site on British National Grid; overlaps counted once, in the more likely band.",
        mapNote: "River flood extents (SEPA). SEPA draws these at 1:85,000 or closer.", link: LINK.sepaMap },
      { id: "coastal", risk: "Sea", agency: "SEPA", title: "The sea (coastal)", layer: "sCo", ds: "sepa", group: "Scotland: Coastal",
        dataset: "Flood Maps: coastal flooding",
        about: "SEPA's coastal flood map shows land that could flood from the sea, in the same three likelihood bands.",
        tech: "SEPA Flood Maps, coastal flooding layers 6 to 8, intersected with the site.",
        mapNote: "Coastal flood extents (SEPA).", link: LINK.sepaMap },
      { id: "surface", risk: "Surface water", agency: "SEPA", title: "Surface water (heavy rain)", layer: "sSw", ds: "sepa", group: "Scotland: Surface water",
        dataset: "Flood Maps: surface water and small watercourses",
        about: "SEPA's surface water map shows where heavy rain and small watercourses could cause flooding, in the same three likelihood bands.",
        tech: "SEPA Flood Maps, surface water and small watercourses layers 3 to 5, intersected with the site.",
        mapNote: "Surface water flood extents (SEPA).", link: LINK.sepaMap },
    ],
  };
  CONCERNS.Unknown = CONCERNS.England;

  // Sources that free, open data cannot cover.
  const NOT_COVERED = {
    Groundwater: "Groundwater flooding happens when water underground rises above the surface, usually after long wet spells. There is no free national map. Check the council's Strategic Flood Risk Assessment.",
    Sewers: "Sewer flooding happens when drains and sewers overflow. Records belong to the water company and are not open. The water company can provide a sewer flooding history search.",
    Reservoirs: "Reservoir flood maps for this nation are not checked by this app. Check the agency's own reservoir flood map.",
    "Historic flooding": "Recorded flood outlines for this nation are not checked by this app.",
    "Surface water": "The surface water map for this nation is not checked by this app. Check the agency's own map.",
  };

  // Public sources, in the order they are listed in section 5.
  const SOURCES = [
    ["Postcode and location", "postcodes.io (ONS Postcode Directory, OS Open Names)", "https://api.postcodes.io"],
    ["Flood zones, England", "Environment Agency Flood Map for Planning, Flood Zones 2 and 3 (rivers and sea)", "https://environment.data.gov.uk/spatialdata/flood-map-for-planning-flood-zones"],
    ["Long-term risk, England", "Environment Agency Risk of Flooding from Rivers and Sea (NaFRA2)", "https://environment.data.gov.uk/spatialdata/nafra2-risk-of-flooding-from-rivers-and-sea"],
    ["Surface water, England", "Environment Agency Risk of Flooding from Surface Water (NaFRA2)", "https://environment.data.gov.uk/spatialdata/nafra2-risk-of-flooding-from-surface-water"],
    ["Reservoirs, England", "Environment Agency Reservoir Flood Extents, wet day", "https://environment.data.gov.uk/spatialdata/reservoir-flood-extents-wet-day"],
    ["Past floods, England", "Environment Agency Recorded Flood Outlines", "https://environment.data.gov.uk/spatialdata/recorded-flood-outlines"],
    ["Warnings and gauges, England", "Environment Agency real-time flood monitoring API (Beta)", "https://environment.data.gov.uk/flood-monitoring"],
    ["Flood zones, Wales", "Natural Resources Wales Flood Map for Planning (rivers and sea), DataMapWales", "https://datamap.gov.wales"],
    ["Flood maps, Scotland", "SEPA Flood Maps (river, surface water and coastal)", "https://map.sepa.org.uk/server/rest/services/Open/Flood_Maps/MapServer"],
    ["Base map", "OpenStreetMap contributors", "https://www.openstreetmap.org/copyright"],
  ];

  const GLOSSARY = [
    ["Annual chance", "How likely flooding is in any one year. 1 in 100 means a 1% chance each year; it can happen in two years running."],
    ["Flood Zone", "England and Wales planning zones for rivers and the sea. Zone 3 is the highest chance, Zone 2 lower. Land outside both is usually Zone 1, but this report never assumes that."],
    ["Likelihood band", "SEPA's classes in Scotland: high (about 1 in 10 a year), medium (about 1 in 200) and low (about 1 in 1,000)."],
    ["Flood extent", "The area a flood of a given size is expected to cover."],
    ["Defended / undefended", "Whether a map takes flood defences such as walls and embankments into account."],
    ["FRA", "Flood Risk Assessment: a site-specific study by a competent professional, often needed for planning. In Wales it is called a Flood Consequences Assessment (FCA)."],
    ["Centroid", "The centre point of the site, used for checks made at a single point."],
    ["British National Grid", "The UK's map grid (EPSG:27700), used here to measure areas in square metres."],
  ];

  const DISCLAIMER = "This report gives preliminary flood risk screening information from public datasets at the time shown. It is not a substitute for a site-specific Flood Risk Assessment by a competent professional, and it is not a planning submission. A missing map feature, unavailable service or empty result must not be read as proof that a site is free from flood risk, or as a Flood Zone 1 classification. Check findings against the current official maps. Do not use this report for emergency or safety-critical decisions.";

  // Round the corners of a map image (white corners, as on the page).
  function roundImage(dataUrl, radius) {
    return new Promise((resolve) => {
      const im = new Image();
      im.onload = () => {
        try {
          const c = document.createElement("canvas"); c.width = im.width; c.height = im.height;
          const g = c.getContext("2d");
          g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
          g.beginPath();
          if (g.roundRect) g.roundRect(0, 0, c.width, c.height, radius); else g.rect(0, 0, c.width, c.height);
          g.clip(); g.drawImage(im, 0, 0);
          resolve(c.toDataURL("image/jpeg", 0.88));
        } catch { resolve(dataUrl); }
      };
      im.onerror = () => resolve(dataUrl);
      im.src = dataUrl;
    });
  }

  FRC.pdfReport = {
    SOURCES, CONCERNS,

    // res: last point check (may be null); site: { features, measured } (may be empty);
    // analysis: site-wide analysis (may be null);
    // opts: { company, logo, accent, siteName, ref, analyst, checkedBy, version, notes, gaps,
    //         sections: { location, zone, other, intersect, live, maps } }
    async build(res, site, analysis, opts) {
      const { jsPDF } = root.jspdf;
      const doc = new jsPDF({ unit: "mm", format: "a4" });
      const W = 210, M = 18, CW = W - 2 * M, TOP = 26, BOTTOM = 276;
      const S = opts.sections;
      const gaps = opts.gaps || [];
      const ACCENT = hexRgb(opts.accent), ACCENT_SOFT = tint(ACCENT, 0.9);
      const hasSite = Boolean(site && site.features.length && site.measured);
      const p = (res && res.place) || {};
      const nation = (res && res.nation) || (analysis && analysis.nation) || "Unknown";
      const when = new Date();
      const siteLabel = opts.siteName || p.postcode || (hasSite ? "Unnamed site" : "Checked location");
      const placeLine = [p.admin_ward, p.admin_district, nation !== "Unknown" ? nation : null].filter(Boolean).join(", ");
      const contents = [];
      let y = TOP;

      // ---------- Layout helpers ----------
      const color = (c) => doc.setTextColor(c[0], c[1], c[2]);
      const fill = (c) => doc.setFillColor(c[0], c[1], c[2]);
      const stroke = (c) => doc.setDrawColor(c[0], c[1], c[2]);
      const font = (style, size) => { doc.setFont("helvetica", style); doc.setFontSize(size); };
      const ensure = (h) => { if (y + h > BOTTOM) { doc.addPage(); y = TOP; } };
      const newPage = () => { doc.addPage(); y = TOP; };
      const gap = (h = 4) => { y += h; };
      const lines = (t, w, size) => { doc.setFontSize(size); return doc.splitTextToSize(String(t), w); };

      // Section opener: a new page with a small number and a large title.
      const section = (n, title, lead) => {
        newPage();
        contents.push({ level: 0, n, title, page: doc.getNumberOfPages() });
        font("bold", 9); color(ACCENT); doc.text(`SECTION ${n}`, M, y + 3);
        font("bold", 22); color(INK); doc.text(title, M, y + 13); y += 19;
        if (lead) { para(lead, 10.5, MUTED); }
        gap(3);
      };
      // Sub-page within section 3, one per source of flooding.
      const subsection = (num, title, agency, chipText) => {
        newPage();
        contents.push({ level: 1, n: num, title, page: doc.getNumberOfPages() });
        font("bold", 8.5); color(MUTED); doc.text(`${num}   ${agency.toUpperCase()}`, M, y + 3);
        font("bold", 19); color(INK); const t = lines(title, CW - 52, 19); doc.text(t, M, y + 12);
        if (chipText) chip(chipText, W - M, y + 6.5, { align: "right", size: 10 });
        y += 8 + t.length * 8; gap(1);
      };
      const h3 = (t) => { ensure(14); gap(3); font("bold", 12); color(INK); const l = lines(t, CW, 12); doc.text(l, M, y + 4.5); y += l.length * 5.4 + 2; };
      const para = (t, size = 10, c = INK, { x = M, w = CW, style = "normal", lh = 0.47 } = {}) => {
        font(style, size); color(c);
        const l = doc.splitTextToSize(String(t), w); const h = size * lh;
        for (const line of l) { ensure(h + 1); doc.text(line, x, y + h * 0.85); y += h; }
        y += 1.6; color(INK);
      };
      const note = (t) => para(t, 8.5, MUTED);
      // A rounded rating chip; returns its width.
      function chip(text, x, yy, { align = "left", size = 9 } = {}) {
        font("bold", size);
        const c = RATING[text] || ACCENT;
        const w = doc.getTextWidth(text) + 7, h = size * 0.62;
        const x0 = align === "right" ? x - w : x;
        fill(c); doc.roundedRect(x0, yy - h / 2, w, h, h / 2, h / 2, "F");
        color(text === "Low" ? INK : WHITE); doc.text(text, x0 + 3.5, yy + size * 0.13);
        color(INK);
        return w;
      }
      // A soft rounded card holding a block of text, with an optional title.
      const card = (title, body, { bg = CARD, bar = null, size = 10, bodyColor = INK } = {}) => {
        const pad = 5, w = CW - 2 * pad;
        font("bold", 10.5); const tl = title ? doc.splitTextToSize(title, w) : [];
        const bodies = (Array.isArray(body) ? body : [body]).filter(Boolean);
        font("normal", size); const bl = bodies.map((b) => doc.splitTextToSize(String(b), w));
        const lh = size * 0.47;
        const h = pad * 2 + tl.length * 5.2 + bl.reduce((s, l) => s + l.length * lh + 1.6, 0) + (tl.length && bl.length ? 1 : 0);
        ensure(h + 2);
        fill(bg); doc.roundedRect(M, y, CW, h, 3.5, 3.5, "F");
        if (bar) { fill(bar); doc.roundedRect(M, y, 2.2, h, 1.1, 1.1, "F"); }
        let yy = y + pad;
        if (tl.length) { font("bold", 10.5); color(INK); doc.text(tl, M + pad, yy + 4); yy += tl.length * 5.2 + 1; }
        font("normal", size); color(bodyColor);
        bl.forEach((l) => { doc.text(l, M + pad, yy + lh * 0.85); yy += l.length * lh + 1.6; });
        color(INK); y += h + 4;
      };
      // Label and value pairs in two columns, in a soft card.
      const facts = (pairs, { cols = 2 } = {}) => {
        const rows = [];
        for (let i = 0; i < pairs.length; i += cols) rows.push(pairs.slice(i, i + cols));
        const pad = 5, colW = (CW - 2 * pad) / cols;
        const rowH = rows.map((r) => Math.max(...r.map(([, v]) => lines(v, colW - 4, 10).length)) * 4.7 + 6.5);
        const h = pad * 2 + rowH.reduce((a, b) => a + b, 0) - 2;
        ensure(h + 2);
        fill(CARD); doc.roundedRect(M, y, CW, h, 3.5, 3.5, "F");
        let yy = y + pad;
        rows.forEach((r, ri) => {
          r.forEach(([k, v], ci) => {
            const x = M + pad + ci * colW;
            font("normal", 8); color(MUTED); doc.text(String(k).toUpperCase(), x, yy + 3);
            font("normal", 10); color(INK); doc.text(lines(v, colW - 4, 10), x, yy + 7.6);
          });
          yy += rowH[ri];
        });
        y += h + 4;
      };
      // Clean table: light header, thin rules, no boxes.
      const table = (cols, rows, { size = 9 } = {}) => {
        const pad = 1.8, lh = size * 0.43;
        const drawRow = (cells, head) => {
          font(head ? "bold" : "normal", head ? size - 0.5 : size);
          const wrapped = cells.map((c, i) => doc.splitTextToSize(String(c == null ? "" : c), cols[i].width - 2 * pad));
          const h = Math.max(...wrapped.map((w) => w.length)) * lh + 2 * pad + 0.6;
          if (y + h > BOTTOM) { newPage(); if (!head) drawRow(cols.map((c) => c.title), true); font(head ? "bold" : "normal", head ? size - 0.5 : size); }
          let x = M;
          color(head ? MUTED : INK);
          wrapped.forEach((w, i) => {
            const c = cols[i];
            if (c.align === "right") doc.text(w, x + c.width - pad, y + pad + lh * 0.85, { align: "right" });
            else doc.text(w, x + pad, y + pad + lh * 0.85);
            x += c.width;
          });
          y += h;
          stroke(LINE); doc.setLineWidth(head ? 0.35 : 0.2); doc.line(M, y, M + CW, y);
          color(INK);
        };
        ensure(14);
        drawRow(cols.map((c) => c.title), true);
        rows.forEach((r) => drawRow(r, false));
        y += 4;
      };
      // Map image with rounded corners, a caption and an optional legend.
      let mapCount = 0;
      const mapImage = async (snap, caption, { maxH = 112, legend = [] } = {}) => {
        if (!S.maps) return null;
        try {
          const label = "Drawing map " + ++mapCount;
          const shot = await (FRC.progress ? FRC.progress.track(FRC.map.snapshot(snap), label) : FRC.map.snapshot(snap));
          const img = await roundImage(shot.img, 28);
          let w = CW, h = (CW * shot.h) / shot.w;
          if (h > maxH) { w = (w * maxH) / h; h = maxH; }
          ensure(h + 16);
          const x = M + (CW - w) / 2;
          doc.addImage(img, "JPEG", x, y, w, h);
          stroke(LINE); doc.setLineWidth(0.3); doc.roundedRect(x, y, w, h, 3, 3, "S");
          y += h + 3;
          if (legend.length) {
            let lx = M; font("normal", 8.5);
            legend.forEach(([c, t, outline]) => {
              const tw = doc.getTextWidth(t) + 10;
              if (lx + tw > M + CW) { lx = M; y += 5; }
              if (outline) { stroke(c); doc.setLineWidth(0.8); doc.roundedRect(lx, y, 5, 3.4, 0.8, 0.8, "S"); }
              else { fill(c); doc.roundedRect(lx, y, 5, 3.4, 0.8, 0.8, "F"); }
              color(INK); doc.text(t, lx + 6.5, y + 2.9); lx += tw + 2;
            });
            y += 6;
          }
          note(`Map ${mapCount}. ${caption} About ${shot.scale}. Base map © OpenStreetMap contributors.`);
          return shot;
        } catch (e) { note("The map could not be drawn in this browser: " + e.message); return null; }
      };
      const pct = (v) => v.toFixed(1) + "%";
      const areaTable = (g, noneText) => table([{ title: "Class", width: 96 }, { title: "Area (m²)", width: 40, align: "right" }, { title: "Share of site", width: CW - 136, align: "right" }],
        [...g.rows.map((r) => [r.label, fmtNum(r.area, 0), pct(r.percent)]), [noneText, fmtNum(g.remainingArea, 0), pct(g.remainingPercent)], ["Whole site", fmtNum(g.siteArea, 0), "100.0%"]]);
      const SITE_LEGEND = [[[122, 61, 184], "Site boundary", true]];
      const SHADE_LEGEND = [[[31, 78, 153], "Site in Zone 3 / high"], [[91, 143, 214], "Site in Zone 2 / medium"], [[169, 198, 238], "Site in other mapped area"]];

      // ---------- Data used by several sections ----------
      const siteBounds = hasSite ? L.geoJSON({ type: "FeatureCollection", features: site.features }).getBounds() : null;
      const centre = hasSite ? [site.measured.centroidWGS[1], site.measured.centroidWGS[0]] : res ? [res.lat, res.lon] : null;
      const view = siteBounds ? { bounds: siteBounds } : centre ? { center: centre, zoom: 15 } : null;
      const datasets = analysis ? analysis.datasets : [];
      const byId = (id) => datasets.find((d) => d.id === id);
      const A = FRC.assessment;
      const risk = A.riskBySource({ analysis, res, nation });
      const fra = A.fraNeed({ analysis, res, site, nation, rows: risk });
      const riskOf = (name) => risk.find((r) => r.source === name || r.source.startsWith(name + " ("));
      const verdictColour = { likely: RATING.High, possible: RATING.Medium, unclear: MUTED, notTriggered: RATING["Very low"] }[fra.verdict] || ACCENT;

      // ---------- Cover ----------
      y = 22;
      if (opts.logo) {
        try {
          const props = doc.getImageProperties(opts.logo);
          const maxW = 80, maxH = 32;
          let w = maxW, h = (maxW * props.height) / props.width;
          if (h > maxH) { h = maxH; w = (maxH * props.width) / props.height; }
          doc.addImage(opts.logo, props.fileType || "PNG", (W - w) / 2, y, w, h); y += h + 8;
        } catch { /* an unreadable logo is left out */ }
      }
      if (opts.company) { font("bold", 13); color(MUTED); doc.text(opts.company, W / 2, y + 4, { align: "center" }); y += 10; }
      if (!opts.logo && !opts.company) y += 8;
      font("bold", 9); color(ACCENT); doc.text("FLOOD RISK SCREENING REPORT", W / 2, y + 3, { align: "center" }); y += 8;
      font("bold", 24); color(INK);
      const titleLines = lines(siteLabel, CW, 24); doc.text(titleLines, W / 2, y + 8, { align: "center" }); y += titleLines.length * 10 + 2;
      if (placeLine) { font("normal", 11.5); color(MUTED); doc.text(lines(placeLine, CW, 11.5), W / 2, y + 4, { align: "center" }); y += 8; }
      gap(3);
      if (view) await mapImage({ view, analysis: false }, `Site location${hasSite ? (site.auto ? ": the 600 m area around the chosen point" : ": site boundary outlined") : ""}.`, { maxH: 92, legend: hasSite ? SITE_LEGEND : [] });
      gap(1);
      facts([
        ["Date", fmtDate(when)], ["Reference", opts.ref || "-"],
        ["Version", opts.version || "-"], ["Status", opts.checkedBy ? "Checked" : "Not checked by a second person"],
        ["Prepared by", opts.analyst || "Not recorded"], ["Checked by", opts.checkedBy || "-"],
      ]);
      font("normal", 7.5); color(MUTED);
      doc.text(lines("Preliminary screening from free, open public data. Not a Flood Risk Assessment and not for safety-critical use. See section 5 for the full disclaimer.", CW, 7.5), W / 2, BOTTOM + 4, { align: "center" });

      // ---------- Contents (filled in at the end) ----------
      newPage();
      const contentsPage = doc.getNumberOfPages();

      // ---------- 1. Summary ----------
      section(1, "Summary", "The answer first. Each source of flooding has its own page in section 3, with a map.");
      card("Is a full Flood Risk Assessment needed?", [fra.headline, ...fra.reasons.map((t) => "•  " + t)], { bar: verdictColour, size: 10 });
      h3("Risk by source of flooding");
      {
        // One rounded row per source: name, coloured rating, short evidence.
        risk.forEach((r) => {
          const ev = lines(r.evidence || "", CW - 80, 8.8);
          const h = Math.max(11, ev.length * 4 + 5);
          ensure(h + 2);
          fill(CARD); doc.roundedRect(M, y, CW, h, 3, 3, "F");
          font("bold", 10); color(INK); doc.text(r.source, M + 4, y + 6.6);
          chip(r.rating, M + 46, y + 5.8, { size: 8.5 });
          font("normal", 8.8); color(MUTED); doc.text(ev, M + 76, y + 5.2);
          y += h + 2; color(INK);
        });
        gap(1);
        note("High means Flood Zone 3 or a high likelihood band; Medium means Flood Zone 2 or a medium band. None mapped means no mapped feature was found: it is not a confirmed low risk.");
      }
      h3("Next steps");
      fra.actions.forEach((t, i) => para(`${i + 1}.   ${t}`, 10));
      if (gaps.length) card("Data gaps", `${gaps.length} part${gaps.length === 1 ? "" : "s"} of the check returned no full result, so ${gaps.length === 1 ? "it is" : "they are"} not reflected here. See Data gaps in section 5.`, { bar: RATING.Medium, size: 9.5 });
      const climate = A.climateNote(nation);
      card("Future flood risk", climate.text + " " + climate.link, { size: 9, bodyColor: MUTED });
      note("Guidance: " + fra.links.join("  ·  ") + ". This is a screening indication. The local planning authority decides whether an assessment is needed.");
      if (opts.notes) card("Notes", opts.notes, { size: 9.5 });

      // ---------- 2. The site ----------
      if (S.location && centre) {
        section(2, "The site", hasSite ? (site.auto ? "The site checked is the 600 m area around the chosen point. Draw or import the real boundary for exact areas." : "Where the site is and how big it is.") : "No site boundary was defined. The results are single-point checks at the location shown.");
        const pairs = [["Site", siteLabel], ["Country", nation]];
        if (placeLine) pairs.push(["Location", [p.admin_ward, p.admin_district].filter(Boolean).join(", ") || "-"]);
        if (p.postcode) pairs.push(["Postcode", p.postcode]);
        pairs.push(["Coordinates (WGS84)", `${centre[0].toFixed(6)}, ${centre[1].toFixed(6)}`]);
        if (hasSite) pairs.push(["Grid reference (BNG)", `E ${fmtNum(site.measured.centroidBNG[0], 1)}, N ${fmtNum(site.measured.centroidBNG[1], 1)}`]);
        else if (p.eastings) pairs.push(["Grid reference (BNG)", `E ${p.eastings}, N ${p.northings}`]);
        if (hasSite) {
          const m = site.measured;
          pairs.push(["Area", `${fmtNum(m.area, 0)} m²  ·  ${fmtNum(m.hectares, 2)} ha  ·  ${fmtNum(m.acres, 2)} acres`], ["Perimeter", `${fmtNum(m.perimeter, 0)} m`]);
          pairs.push(["Parcels", String(m.parcels.length) + (m.holes ? ` (with ${m.holes} hole${m.holes > 1 ? "s" : ""})` : "")]);
        }
        facts(pairs);
        if (hasSite && site.measured.parcels.length > 1) table([{ title: "Parcel", width: 76 }, { title: "Area (m²)", width: 36, align: "right" }, { title: "Hectares", width: 30, align: "right" }, { title: "Perimeter (m)", width: CW - 142, align: "right" }], site.measured.parcels.map((pc) => [pc.name, fmtNum(pc.area, 0), fmtNum(pc.area / 10000, 2), fmtNum(pc.perimeter, 1)]));
        if (hasSite) site.warnings.forEach((w) => note("Note: " + w));
        await mapImage({ view: { center: centre, zoom: 13 } }, "The site in its wider area.", { maxH: 80, legend: hasSite ? SITE_LEGEND : [] });
        if (hasSite) card(null, "Technical: areas are measured on the British National Grid (EPSG:27700) from the boundary's corner points. Grid areas can differ from ground areas by up to about 0.1%.", { size: 8.5, bodyColor: MUTED });
      }

      // ---------- 3. Flood risk by source ----------
      const concerns = (CONCERNS[nation] || []).filter((c) => (c.id === "rivers" || c.id === "longterm" || c.id === "coastal") ? S.zone : S.other);
      if ((S.zone || S.other) && nation !== "Northern Ireland") {
        section(3, "Flood risk by source", "One page for each source of flooding. Each map shows only that agency's layer, with the site outlined.");
        card("How to read these pages", [
          "Each page starts with the rating and a short answer in plain words, then the map.",
          "The grey box at the bottom gives the technical detail for engineers: the dataset, the method and when the data was retrieved.",
          "Each page ends with a link to the agency's own official map, where the result can be checked.",
        ], { size: 9.5 });
        gap(2);
        // A key to the rating colours.
        ["High", "Medium", "Low", "None mapped", "Not assessed"].forEach((r) => {
          ensure(9); chip(r, M, y + 3, { size: 8.5 });
          font("normal", 8.8); color(MUTED); const l = lines(MEANS[r], CW - 36, 8.8); doc.text(l, M + 34, y + 3.8); y += Math.max(7, l.length * 4 + 3);
        });
        color(INK);

        let k = 0;
        for (const c of concerns) {
          k++;
          // Rating and evidence for this source.
          let rating = "Not assessed", evidence = "", d = c.ds ? byId(c.ds) : null, group = null;
          if (c.band) {
            if (res && res.errors && res.errors.band) { rating = "No result"; evidence = "Service unavailable: " + res.errors.band; }
            else if (res && res.band && res.band.band) { rating = /very low/i.test(res.band.band) ? "Very low" : /high/i.test(res.band.band) ? "High" : /medium/i.test(res.band.band) ? "Medium" : /low/i.test(res.band.band) ? "Low" : res.band.band; evidence = `Band "${res.band.band}" at ${res.fromSite ? "the site centroid" : "the checked point"}.`; }
            else if (res && res.band) { rating = "See the map"; evidence = "No band was returned at the point. This is not a confirmed very low result."; }
          } else {
            const r = c.risk && riskOf(c.risk);
            if (r) { rating = r.rating; evidence = r.evidence; }
          }
          if (d && c.group) group = (d.groups || []).find((g) => g.group === c.group);
          subsection(`3.${k}`, c.title, c.agency, rating);
          card("In short", [MEANS[rating] || "", evidence].filter(Boolean), { bar: RATING[rating] || ACCENT, size: 10 });
          const minZoom = c.minZoom || (c.layer && c.layer.startsWith("s") && nation === "Scotland" ? FRC.mapLayers.sepaMinZoom : 0);
          if (view && c.layer) await mapImage({ view, overlays: [c.layer], analysis: Boolean(c.shade), minZoom }, `${c.mapNote}${minZoom ? " Zoomed in so the layer draws." : ""}`,
            { maxH: 86, legend: hasSite ? [...SITE_LEGEND, ...(c.shade && analysis ? SHADE_LEGEND : [])] : [] });
          // Areas on the site, where the dataset was measured across it.
          if (S.intersect && d && d.status !== "notAssessed") {
            const groups = c.group ? (group ? [group] : []) : (d.groups || []);
            // Only when part of the site is in a mapped area; "none of the site" is already said above.
            const hit = groups.filter((g) => g.siteArea && g.rows && g.rows.length);
            if (hit.length) { h3("How much of the site is affected"); hit.forEach((g) => areaTable(g, d.noneText || "Not in a mapped area")); }
          }
          h3("What this means");
          para(c.about, 10);
          // Technical box.
          const techBits = [c.tech];
          if (d) techBits.push(`Status: ${d.statusText}${d.retrieved ? `, retrieved ${fmtDate(d.retrieved)}` : ""}.`);
          else if (c.band && res && res.band && res.band.retrieved) techBits.push(`Retrieved ${fmtDate(res.band.retrieved)}.`);
          if (d && d.error) techBits.push("Reason: " + d.error);
          if (d) (d.notes || []).filter((n) => !c.group || !/^Scotland: (?!.*River)/.test(n) || n.includes(c.group)).slice(0, 4).forEach((n) => techBits.push(n));
          card(`Technical detail: ${c.dataset}`, techBits, { size: 8.5, bodyColor: MUTED });
          if (c.link) { font("normal", 9); color(ACCENT); ensure(6); doc.textWithLink("Check it on the official map: " + c.link, M, y + 4, { url: c.link }); y += 8; color(INK); }
        }

        // Sources that open data does not cover, together on one page.
        const missing = risk.filter((r) => r.rating === "Not assessed" && !concerns.some((c) => c.risk === r.source));
        if (missing.length) {
          k++;
          subsection(`3.${k}`, "Sources not checked", "Free, open data", null);
          para("These sources of flooding cannot be checked with free, open national data. A full Flood Risk Assessment would cover them.", 10, MUTED);
          gap(2);
          missing.forEach((r) => card(r.source, NOT_COVERED[r.source.replace(/ \(.*\)$/, "")] || r.evidence, { size: 9.5 }));
        }
      } else if ((S.zone || S.other) && nation === "Northern Ireland") {
        section(3, "Flood risk by source");
        card("Not covered", "Northern Ireland flood map data is not open, so no source could be checked. Check the official Flood Maps NI viewer: " + (A.LINKS.floodMapsNI || ""), { bar: MUTED });
      }

      // ---------- 4. Flood warnings and river gauges ----------
      if (S.live) {
        section(4, "Flood warnings and river gauges", "Live information from the Environment Agency, which changes quickly.");
        if (!res) card(null, "No point check was run.");
        else if (nation !== "England" && nation !== "Unknown") card(null, "Live flood warnings and river gauge readings are available for England only.");
        else {
          note(`Checked within ${res.dist} km of ${res.fromSite ? "the site centroid" : "the checked point"}.`);
          h3("Flood warnings and alerts");
          if (res.errors.live) card("Service unavailable", res.errors.live, { bar: RATING["No result"], size: 9.5 });
          else if (!res.live) card(null, "Not checked.");
          else if (!res.live.length) card(null, "No flood warnings or alerts in force at the time of the check.", { bar: RATING["Very low"] });
          else table([{ title: "Severity", width: 34 }, { title: "Area", width: 96 }, { title: "Raised", width: CW - 130 }], res.live.map((w) => [w.severity, w.description, fmtDate(w.raised)]));
          h3("River gauges");
          if (res.errors.gauges) card("Service unavailable", res.errors.gauges, { bar: RATING["No result"], size: 9.5 });
          else if (!res.gauges) card(null, "Not checked.");
          else if (!res.gauges.length) card(null, "No river level gauges in this radius.");
          else {
            table([{ title: "Gauge", width: 66 }, { title: "Distance", width: 24, align: "right" }, { title: "Latest level", width: 28, align: "right" }, { title: "Reading time", width: CW - 118 }],
              res.gauges.map((g) => [g.name + (g.river ? ", " + g.river : ""), g.km.toFixed(1) + " km", g.value != null ? g.value.toFixed(2) + " " + (g.unit || "m") : "-", g.value != null ? fmtDate(g.time) : "No recent reading"]));
            if (centre) await mapImage({ view: { center: centre, zoom: res.dist >= 5 ? 11 : 12 } }, "River gauges near the site (blue dots).", { maxH: 80 });
          }
          card(null, `Technical: Environment Agency real-time flood monitoring API (Beta), retrieved ${res.liveAt ? fmtDate(res.liveAt) : "-"}. Check the Environment Agency's flood warning service for the current position.`, { size: 8.5, bodyColor: MUTED });
        }
      }

      // ---------- 5. Data, method and limitations (always) ----------
      section(5, "Data, method and limitations", "Where the data comes from, how it was used, and what this report cannot tell you.");
      h3("Data sources");
      table([{ title: "Data", width: 40 }, { title: "Source", width: 70 }, { title: "Link", width: CW - 110 }], SOURCES.map((s) => s), { size: 8.5 });
      note("Contains Environment Agency information © Environment Agency and database right. Contains Natural Resources Wales information © Natural Resources Wales and Database Right. All rights Reserved. Contains SEPA data © Scottish Environment Protection Agency. All used under the Open Government Licence v3.0. This uses Environment Agency flood and river level data from the real-time data API (Beta). Map data © OpenStreetMap contributors.");
      h3("Data status and retrieval times");
      const status = [];
      datasets.forEach((d) => status.push([d.name.split(" (")[0], d.statusText, d.retrieved ? fmtDate(d.retrieved) : "-"]));
      if (res) FRC.results.dataStatus(res).forEach((r) => status.push([r.name + (res.fromSite ? " (site centroid)" : " (point)"), r.status[1], r.when ? fmtDate(r.when) : "-"]));
      if (status.length) table([{ title: "Dataset", width: 82 }, { title: "Status", width: 54 }, { title: "Retrieved", width: CW - 136 }], status, { size: 8.5 });
      else note("No data was retrieved.");
      h3("Data gaps");
      if (gaps.length) {
        para(`${gaps.length} part${gaps.length === 1 ? "" : "s"} of the check did not return a full result when this report was made. The findings above do not include ${gaps.length === 1 ? "it" : "them"}.`, 9.5);
        table([{ title: "Part", width: 62 }, { title: "Problem", width: 58 }, { title: "What it means", width: CW - 120 }],
          gaps.map((g) => [g.what, String(g.message || "").slice(0, 160), (FRC.errorLog && FRC.errorLog.hint(g.message)) || "Run the check again before relying on this part."]), { size: 8.5 });
      } else note("None. Every part of the check returned a result.");
      h3("Method");
      para("The site boundary is checked and measured on the British National Grid (EPSG:27700). The site's country is taken from its centre point, and each flood dataset for that country is asked for the site's area. Each dataset's polygons are converted to British National Grid and cut to the site. Polygons of the same class are merged so overlaps count once, and land in two classes is counted once, in the more severe. Each agency's own classes are kept: Flood Zones in England and Wales, likelihood bands in Scotland. Datasets published only as map images (surface water and long-term risk in England) and the live data are checked at a single point, and shown on their own maps.", 9.5);
      h3("Limitations");
      [
        "The flood zone services publish Zones 2 and 3 only. Land with no mapped polygon is not classified as Flood Zone 1.",
        "A site that crosses a national border is checked only against the datasets for its centre point's country.",
        "Very large sites can reach a service's result limit; this is reported as partial coverage.",
        "The British National Grid conversion uses a standard 7-parameter shift, accurate to a few metres.",
        "Groundwater and sewer flooding are not checked: there is no open national data.",
        "Flood levels, ground and floor levels (mAOD), flood defences, residual risk, safe access and drainage are not assessed. A full Flood Risk Assessment covers them.",
        "Results show present-day risk unless stated. Climate change allowances are not applied.",
        "Northern Ireland is not covered.",
        "To reduce errors, results may be reused from this browser for up to 60 minutes. Pressing Check always fetches fresh data.",
      ].forEach((t) => para("•   " + t, 9.5));
      h3("Glossary");
      table([{ title: "Term", width: 42 }, { title: "Meaning", width: CW - 42 }], GLOSSARY, { size: 8.8 });
      h3("Disclaimer");
      para(DISCLAIMER, 9);
      note(`Generated with Flood Risk Checker version ${root.FRC_VERSION || "unknown"}, using only free, open data under the licences above.`);

      // ---------- Contents ----------
      doc.setPage(contentsPage); y = TOP;
      font("bold", 22); color(INK); doc.text("Contents", M, y + 10); y += 22;
      contents.forEach((e) => {
        const top = e.level === 0;
        font(top ? "bold" : "normal", top ? 11.5 : 10); color(top ? INK : MUTED);
        const x = M + (top ? 0 : 10);
        doc.text(`${e.n}${top ? "." : ""}   ${e.title}`, x, y + 4);
        doc.text(String(e.page), W - M, y + 4, { align: "right" });
        stroke(LINE); doc.setLineWidth(0.15); doc.line(x, y + 6.4, W - M, y + 6.4);
        y += top ? 10 : 8;
        if (top) y += 0;
      });

      // ---------- Header and footer on every page except the cover ----------
      const pages = doc.getNumberOfPages();
      for (let i = 2; i <= pages; i++) {
        doc.setPage(i);
        font("normal", 7.8); color(MUTED);
        doc.text([opts.company, siteLabel].filter(Boolean).join("  ·  "), M, 13);
        const refText = [opts.ref, opts.version && "Version " + opts.version].filter(Boolean).join("  ·  ");
        if (refText) doc.text(refText, W - M, 13, { align: "right" });
        doc.text(`Flood risk screening  ·  ${fmtDate(when)}`, M, 287);
        doc.text(`${i} / ${pages}`, W - M, 287, { align: "right" });
      }
      color(INK);
      const base = (opts.siteName || p.postcode || "site").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "site";
      const pad2 = (n) => String(n).padStart(2, "0");
      const day = `${when.getFullYear()}-${pad2(when.getMonth() + 1)}-${pad2(when.getDate())}`; // local date, as printed in the report
      doc.save(`flood-report-${base}-${day}.pdf`);
    },
  };
})(typeof window !== "undefined" ? window : globalThis);
