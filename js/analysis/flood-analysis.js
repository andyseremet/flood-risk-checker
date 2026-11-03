// Site-wide flood-zone analysis: fetch flood polygons for the site's extent,
// normalise them, intersect with the site and return results per dataset with
// an explicit status. A dataset is only queried for the nation it covers.
(function (root) {
  "use strict";
  const FRC = (root.FRC = root.FRC || {});

  const STATUS = {
    completed: "Analysis completed",
    none: "No mapped feature identified",
    partial: "Partial coverage",
    notAssessed: "Not assessed",
    unavailable: "Service unavailable",
    error: "Processing error",
  };

  // Bounding box [minLon, minLat, maxLon, maxLat] of the site, slightly padded.
  function siteBox(geoms, pad = 0.0002) {
    let a = [Infinity, Infinity, -Infinity, -Infinity];
    geoms.forEach((g) => FRC.projections.mapCoords(g, (c) => {
      a = [Math.min(a[0], c[0]), Math.min(a[1], c[1]), Math.max(a[2], c[0]), Math.max(a[3], c[1])];
      return c;
    }));
    return [a[0] - pad, a[1] - pad, a[2] + pad, a[3] + pad].map((v) => Math.round(v * 1e7) / 1e7);
  }

  const fmtDay = (v) => { const d = v ? new Date(v) : null; return d && !isNaN(d) ? d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : null; };
  const listNote = (title, lines, max = 10) => lines.length
    ? `${title}: ${lines.slice(0, max).join("; ")}${lines.length > max ? `; and ${lines.length - max} more` : ""}.` : null;

  // kind "area": polygons intersected with the site (areas and %).
  // kind "point": map-image services that can only be checked at a point.
  // kind "none": no open dataset, always reported as not assessed.
  // primary: shaded on the map after analysis.
  const DATASETS = [
    { id: "ea", nation: "England", primary: true, name: "Environment Agency Flood Map for Planning (Flood Zones 2 and 3, rivers and sea)",
      fetch: (box) => FRC.ea.zonesInBox(box), normalise: (f) => FRC.normalise.ea(f),
      noneText: "No Flood Zone 2 or 3 polygon mapped" },
    { id: "ea-sw", nation: "England", kind: "point", name: "Environment Agency Risk of Flooding from Surface Water",
      check: (lat, lon) => FRC.ea.surfaceWaterAtPoint(lat, lon) },
    { id: "ea-res", nation: "England", name: "Environment Agency Reservoir Flood Extents (wet day)",
      fetch: (box) => FRC.ea.reservoirInBox(box), normalise: (f) => FRC.normalise.eaReservoir(f),
      noneText: "No reservoir flood extent mapped",
      details: (fs) => [listNote("Reservoirs whose flood extent reaches the site", fs.map((f) => {
        const p = f.properties || {};
        return [p.reservoir || "Unnamed reservoir", p.undertaker && `owner ${p.undertaker}`, p.risk_designation && `designation ${p.risk_designation}`].filter(Boolean).join(", ");
      })), "Reservoir flood extents show a credible worst case if a large raised reservoir failed while rivers are already in flood. They give no likelihood, and reservoir failure is very unlikely. Smaller reservoirs and those built after October 2016 are not included."] },
    { id: "ea-rec", nation: "England", name: "Environment Agency Recorded Flood Outlines (historic flooding)",
      fetch: (box) => FRC.ea.recordedInBox(box), normalise: (f) => FRC.normalise.eaRecorded(f),
      noneText: "No recorded flood outline mapped",
      details: (fs) => [listNote("Recorded floods that reach the site", fs.map((f) => {
        const p = f.properties || {};
        const when = [fmtDay(p.start_date), fmtDay(p.end_date)].filter(Boolean);
        return [p.name || "Unnamed event", when.length ? when.join(" to ") : null, p.flood_src && `source ${p.flood_src}`, p.flood_caus && `cause ${p.flood_caus}`].filter(Boolean).join(", ");
      })), "Recorded outlines show where flooding has been recorded since about 1946. They are not complete: many past floods were never mapped, and the absence of an outline does not mean a site has never flooded."] },
    { id: "nrw", nation: "Wales", primary: true, name: "Natural Resources Wales Flood Map for Planning (rivers and sea)",
      fetch: (box) => FRC.nrw.zonesInBox(box), normalise: (f) => FRC.normalise.nrw(f),
      noneText: "No flood zone polygon mapped" },
    { id: "sepa", nation: "Scotland", primary: true, name: "SEPA Flood Maps (river, surface water and coastal)",
      fetch: (box) => FRC.sepa.extentsInBox(box), normalise: (f) => FRC.normalise.sepa(f),
      noneText: "No flood extent mapped" },
    { id: "gw", nation: "All", kind: "none", name: "Groundwater flooding",
      reason: "No open national groundwater flood dataset is available for England, Wales or Scotland. The British Geological Survey's groundwater flooding susceptibility data is licensed, not open." },
  ];

  async function runPointDataset(ds, centroid) {
    const out = { id: ds.id, nation: ds.nation, name: ds.name, kind: "point", groups: [], notes: [], retrieved: null };
    const [lon, lat] = centroid;
    let r;
    try { r = await ds.check(lat, lon); } catch (e) {
      return { ...out, status: "unavailable", statusText: STATUS.unavailable, error: e.message };
    }
    out.retrieved = r.retrieved;
    out.band = r.band || null;
    out.status = r.band ? "completed" : "none";
    out.statusText = STATUS[out.status];
    out.summary = r.band ? `At the site centroid: ${r.band}.` : "At the site centroid: no surface water risk band mapped.";
    out.notes.push("Checked at the site centroid only. This dataset is published as map images, not polygons, so the area of the site affected cannot be measured here. Turn on the surface water map layer to see the pattern across the site.");
    if (!r.band) out.notes.push("No mapped band does not establish that the site is free from surface water flood risk.");
    return out;
  }

  async function runDataset(ds, geoms, box) {
    const out = { id: ds.id, nation: ds.nation, name: ds.name, primary: Boolean(ds.primary), noneText: ds.noneText, groups: [], notes: [], retrieved: null };
    let fetched;
    try { fetched = await ds.fetch(box); } catch (e) {
      return { ...out, status: "unavailable", statusText: STATUS.unavailable, error: e.message };
    }
    out.retrieved = fetched.retrieved;
    try {
      const items = ds.normalise(fetched.features);
      const byGroup = new Map();
      items.forEach((it) => { if (!byGroup.has(it.group)) byGroup.set(it.group, []); byGroup.get(it.group).push(it); });
      if (!byGroup.size) byGroup.set(ds.nation, []);
      const C = FRC.compute || FRC.intersections;
      const done = await Promise.all([...byGroup].map(async ([group, list]) => ({ group, ...(await C.analyseGroup(geoms, list)) })));
      out.groups.push(...done);
    } catch (e) {
      return { ...out, status: "error", statusText: STATUS.error, error: e.message };
    }
    const anyHit = out.groups.some((g) => g.coveredArea > 0.01);
    out.status = fetched.partial ? "partial" : anyHit ? "completed" : "none";
    out.statusText = STATUS[out.status];
    const est = out.groups.find((g) => g.estimate);
    if (est) {
      out.estimated = true;
      out.statusText += " (areas estimated)";
      out.notes.push(`These polygons were too complex to clip exactly, so the areas are estimated from ${FRC.util.fmtNum(est.estimate.points, 0)} sample points about ${FRC.util.fmtNum(est.estimate.spacing, 1)} m apart. Expect an error of about 1 to 2% of the site. The estimated parts are not shaded on the map.`);
    }
    (fetched.notes || []).forEach((n) => out.notes.push(n));
    if (fetched.partial && !(fetched.notes || []).length) out.notes.push("The service returned only part of the polygons for this area (its result limit was reached). Areas may be under-counted.");
    if (!anyHit && !fetched.partial) out.notes.push(ds.primary
      ? "No mapped polygon from this dataset intersects the site. This does not establish that the site is free from flood risk or that it is in Flood Zone 1."
      : "No mapped polygon from this dataset intersects the site. This does not establish that the site is free from this type of flood risk.");
    if (ds.details) {
      const hits = anyHit ? await (FRC.compute || FRC.intersections).touching(geoms, fetched.features) : [];
      if (hits) ds.details(hits).forEach((n) => { if (n) out.notes.push(n); });
      else out.notes.push("The names of the features reaching the site could not be listed in time, because the polygons are very detailed.");
    }
    out.groups.forEach((g) => g.overlaps.forEach((o) => out.notes.push(
      `${g.group}: ${FRC.util.fmtNum(o.area, 0)} m² of ${o.label} polygons also lie inside a more severe class. That area is counted once, in the more severe class.`)));
    return out;
  }

  FRC.floodAnalysis = {
    STATUS,
    DATASETS,
    siteBox,

    // features: validated WGS84 site parcels. nation: from the centroid lookup.
    async analyseSite(features, nation) {
      const geoms = features.map((f) => f.geometry);
      const box = siteBox(geoms);
      const started = new Date();
      const centroid = FRC.measurements.measureSite(features).centroidWGS;
      const wanted = DATASETS.filter((d) => d.kind !== "none" && (nation === "Unknown" || d.nation === nation));
      const notAssessed = (d, reason) => Promise.resolve({ id: d.id, nation: d.nation, name: d.name, status: "notAssessed", statusText: STATUS.notAssessed, groups: [], notes: [reason] });
      const results = await Promise.all(DATASETS.map((d) => {
        if (d.kind === "none") return notAssessed(d, d.reason);
        if (!wanted.includes(d)) return notAssessed(d, `The site centroid is not in ${d.nation}.`);
        return d.kind === "point" ? runPointDataset(d, centroid) : runDataset(d, geoms, box);
      }));
      const notes = [];
      if (nation === "Northern Ireland") notes.push("Northern Ireland flood map data is not open, so the site cannot be analysed.");
      if (nation === "Unknown") notes.push("The site's country could not be identified, so every dataset was queried.");
      return { started, box, nation, datasets: results, notes };
    },
  };
})(typeof window !== "undefined" ? window : globalThis);
