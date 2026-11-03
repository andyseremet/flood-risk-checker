// PDF screening report (jsPDF + html2canvas for the map image).
(function (root) {
  "use strict";
  const FRC = (root.FRC = root.FRC || {});
  const { fmtDate, fmtNum } = FRC.util;

  FRC.pdfReport = {
    // res: last flood check (may be null); site: { features, measured } (may be empty);
    // opts: { siteName, ref, analyst, notes, sections: {location,map,site,zone,band,live,gauges} }
    async build(res, site, opts) {
      const { jsPDF } = root.jspdf;
      const doc = new jsPDF({ unit: "mm", format: "a4" });
      const W = 210, M = 16, CW = W - 2 * M;
      let y = M;
      const ensure = (h) => { if (y + h > 280) { doc.addPage(); y = M; } };
      const h1 = (t) => { doc.setFont("helvetica", "bold"); doc.setFontSize(18); doc.text(t, M, y + 6); y += 11; };
      const h2 = (t) => { ensure(14); y += 3; doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.setTextColor(11, 110, 138); doc.text(t, M, y + 4); doc.setTextColor(20, 35, 43); y += 8; };
      const para = (t, size = 10) => { doc.setFont("helvetica", "normal"); doc.setFontSize(size); const lines = doc.splitTextToSize(String(t), CW); ensure(lines.length * size * 0.45 + 2); doc.text(lines, M, y + 4); y += lines.length * size * 0.45 + 2; };
      const kv = (k, v) => { ensure(6); doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.text(String(k), M, y + 4); doc.setFont("helvetica", "normal"); const lines = doc.splitTextToSize(String(v), CW - 46); doc.text(lines, M + 46, y + 4); y += Math.max(1, lines.length) * 4.6 + 1; };
      const S = opts.sections;
      const hasSite = site && site.features.length && site.measured;
      const p = (res && res.place) || {};
      const when = new Date();

      doc.setTextColor(20, 35, 43);
      h1("Flood risk screening report");
      para([opts.siteName || p.postcode || "Unnamed site", res ? res.nation : null, "Generated " + fmtDate(when)].filter(Boolean).join("  ·  "), 10);
      if (opts.ref || opts.analyst) para([opts.ref && "Reference: " + opts.ref, opts.analyst && "Analyst: " + opts.analyst].filter(Boolean).join("   "), 10);
      if (opts.notes) { h2("Notes"); para(opts.notes); }

      if (S.location && res) {
        h2(res.fromSite ? "Location (site centroid)" : "Location summary");
        kv("Postcode", p.postcode || "Not found");
        kv("Area", [p.admin_ward, p.admin_district].filter(Boolean).join(", ") || "-");
        kv("Nation", res.nation);
        kv("Coordinates", `${res.lat.toFixed(5)}, ${res.lon.toFixed(5)}`);
        if (p.eastings) kv("Grid reference", `E ${p.eastings}, N ${p.northings}`);
      }

      if (S.site && hasSite) {
        const m = site.measured;
        h2("Site boundary and measurements");
        kv("Parcels", String(m.parcels.length) + (m.holes ? ` (with ${m.holes} hole${m.holes > 1 ? "s" : ""})` : ""));
        kv("Site area", `${fmtNum(m.area, 0)} m²  ·  ${fmtNum(m.hectares, 2)} ha  ·  ${fmtNum(m.acres, 2)} acres`);
        kv("Perimeter", `${fmtNum(m.perimeter, 1)} m`);
        kv("Centroid (WGS84)", `${m.centroidWGS[1].toFixed(6)}, ${m.centroidWGS[0].toFixed(6)}`);
        kv("Centroid (BNG)", `E ${fmtNum(m.centroidBNG[0], 1)}, N ${fmtNum(m.centroidBNG[1], 1)}`);
        if (m.parcels.length > 1) m.parcels.forEach((pc) => kv("  " + pc.name, `${fmtNum(pc.area, 0)} m²  ·  perimeter ${fmtNum(pc.perimeter, 1)} m`));
        site.warnings.forEach((w) => para("Note: " + w, 9));
        para("Measured on the British National Grid (EPSG:27700) from the boundary's corner points. Grid areas can differ from ground areas by up to about 0.1% depending on location.", 8.5);
      }

      if (S.map) {
        try {
          const canvas = await root.html2canvas(document.getElementById("map"), { useCORS: true, logging: false, scale: 1, ignoreElements: (el) => el.classList && el.classList.contains("leaflet-control-container") });
          const img = canvas.toDataURL("image/jpeg", 0.85);
          let w = CW, h = (CW * canvas.height) / canvas.width;
          if (h > 100) { w = (w * 100) / h; h = 100; }
          h2(hasSite ? "Site location plan" : "Location map"); ensure(h + 4);
          doc.addImage(img, "JPEG", M + (CW - w) / 2, y, w, h); y += h + 2;
          para("Map: © OpenStreetMap contributors. Flood layers as shown on screen.", 8);
        } catch { h2("Location map"); para("The map image could not be captured in this browser."); }
      }

      if (res) {
        if (S.zone) {
          h2(res.fromSite ? "Flood zone at site centroid" : "Flood zone result");
          const z = FRC.results.zoneSummary(res);
          kv("Result", z.pill[1]); para(z.text);
          if (res.fromSite) para("This is a single-point check at the centroid. It does not show how much of the site lies in each flood zone.", 9);
        }
        if (S.band && (res.band || res.errors.band)) {
          h2("Long-term risk band (rivers and sea)");
          if (res.errors.band) para("Service unavailable: " + res.errors.band);
          else if (!res.band.band) para("No risk band was returned at this point. This is not a confirmed very low result.");
          else { kv("Risk band", res.band.band); para("Environment Agency Risk of Flooding from Rivers and Sea, which takes flood defences into account."); }
        }
        if (S.live && (res.live || res.errors.live)) {
          h2(`Live warnings and alerts within ${res.dist} km`);
          if (res.errors.live) para("Service unavailable: " + res.errors.live);
          else if (!res.live.length) para(`No flood warnings or alerts in force at ${fmtDate(res.liveAt)}.`);
          else res.live.forEach((w) => { kv(w.severity, w.description); para(`Raised ${fmtDate(w.raised)}. ${w.message}`.slice(0, 600), 9); });
        }
        if (S.gauges && res.gauges) {
          h2("Nearby river gauges");
          if (!res.gauges.length) para(`No river level gauges within ${res.dist} km.`);
          res.gauges.forEach((g) => kv(`${g.km.toFixed(1)} km`, `${g.name}${g.river ? ", " + g.river : ""}: ${g.value != null ? g.value.toFixed(2) + " m at " + fmtDate(g.time) : "no recent reading"}`));
        }
        h2("Data status");
        FRC.results.dataStatus(res).forEach((r) => kv(r.name, r.status[1] + (r.when ? `  (retrieved ${fmtDate(r.when)})` : "")));
      }

      h2("Data sources, methodology and limitations");
      para("This uses Environment Agency flood and river level data from the real-time data API (Beta). Contains Environment Agency information © Environment Agency and database right. Contains Natural Resources Wales information © Natural Resources Wales and Database Right. All rights Reserved. Contains SEPA data © Scottish Environment Protection Agency. All data used under the Open Government Licence v3.0. Postcode data from postcodes.io (ONS Postcode Directory, OS Open Names). Map data © OpenStreetMap contributors.", 8.5);
      para("This report is a preliminary screening summary built from public datasets at the time shown. A missing map feature, unavailable service or empty query result must not be interpreted as proof of no flood risk or as a definitive Flood Zone 1 classification. Verify findings against the current official mapping and relevant site-specific evidence. This is not a formal Flood Risk Assessment, planning submission or substitute for professional advice, and must not be used for emergency or safety-critical decisions. Northern Ireland is not covered by this prototype.", 8.5);

      const pages = doc.getNumberOfPages();
      for (let i = 1; i <= pages; i++) { doc.setPage(i); doc.setFontSize(8); doc.setTextColor(85, 112, 121); doc.text(`Flood Risk Checker  ·  preliminary screening  ·  page ${i} of ${pages}`, M, 290); }
      const base = (opts.siteName || p.postcode || "site").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "site";
      doc.save(`flood-report-${base}-${when.toISOString().slice(0, 10)}.pdf`);
    },
  };
})(typeof window !== "undefined" ? window : globalThis);
