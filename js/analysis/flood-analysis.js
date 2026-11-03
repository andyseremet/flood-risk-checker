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

  const DATASETS = [
    { id: "ea", nation: "England", name: "Environment Agency Flood Map for Planning (Flood Zones 2 and 3, rivers and sea)",
      fetch: (box) => FRC.ea.zonesInBox(box), normalise: (f) => FRC.normalise.ea(f),
      noneText: "No Flood Zone 2 or 3 polygon mapped" },
    { id: "nrw", nation: "Wales", name: "Natural Resources Wales Flood Map for Planning (rivers and sea)",
      fetch: (box) => FRC.nrw.zonesInBox(box), normalise: (f) => FRC.normalise.nrw(f),
      noneText: "No flood zone polygon mapped" },
    { id: "sepa", nation: "Scotland", name: "SEPA Flood Maps (river, surface water and coastal)",
      fetch: (box) => FRC.sepa.extentsInBox(box), normalise: (f) => FRC.normalise.sepa(f),
      noneText: "No flood extent mapped" },
  ];

  async function runDataset(ds, geoms, box) {
    const out = { id: ds.id, nation: ds.nation, name: ds.name, noneText: ds.noneText, groups: [], notes: [], retrieved: null };
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
      for (const [group, list] of byGroup) out.groups.push({ group, ...FRC.intersections.analyseGroup(geoms, list) });
    } catch (e) {
      return { ...out, status: "error", statusText: STATUS.error, error: e.message };
    }
    const anyHit = out.groups.some((g) => g.coveredArea > 0.01);
    out.status = fetched.partial ? "partial" : anyHit ? "completed" : "none";
    out.statusText = STATUS[out.status];
    if (fetched.partial) out.notes.push("The service returned only part of the polygons for this area (its result limit was reached). Areas may be under-counted.");
    if (!anyHit && !fetched.partial) out.notes.push("No mapped polygon from this dataset intersects the site. This does not establish that the site is free from flood risk or that it is in Flood Zone 1.");
    out.groups.forEach((g) => g.overlaps.forEach((o) => out.notes.push(
      `${g.group}: ${FRC.util.fmtNum(o.area, 0)} m² of ${o.label} polygons also lie inside a more severe class. That area is counted once, in the more severe class.`)));
    return out;
  }

  FRC.floodAnalysis = {
    STATUS,
    siteBox,

    // features: validated WGS84 site parcels. nation: from the centroid lookup.
    async analyseSite(features, nation) {
      const geoms = features.map((f) => f.geometry);
      const box = siteBox(geoms);
      const started = new Date();
      const wanted = DATASETS.filter((d) => nation === "Unknown" || d.nation === nation);
      const results = await Promise.all(DATASETS.map((d) => wanted.includes(d)
        ? runDataset(d, geoms, box)
        : Promise.resolve({ id: d.id, nation: d.nation, name: d.name, status: "notAssessed", statusText: STATUS.notAssessed, groups: [], notes: [`The site centroid is not in ${d.nation}.`] })));
      const notes = [];
      if (nation === "Northern Ireland") notes.push("Northern Ireland flood map data is not open, so the site cannot be analysed.");
      if (nation === "Unknown") notes.push("The site's country could not be identified, so every dataset was queried.");
      return { started, box, nation, datasets: results, notes };
    },
  };
})(typeof window !== "undefined" ? window : globalThis);
