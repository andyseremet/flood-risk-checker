// Background worker for the polygon measurements. Very detailed flood
// polygons (for example along the River Ouse in York) can keep the clipping
// library busy for a long time. Running it here keeps the page responsive,
// and lets the page stop a measurement that takes too long.
/* global importScripts */
"use strict";
const v = self.location.search; // same ?v= version tag as the page
importScripts(
  "https://cdn.jsdelivr.net/npm/@turf/turf@6.5.0/turf.min.js",
  "https://cdn.jsdelivr.net/npm/proj4@2.9.2/dist/proj4.js",
  "../config.js" + v,
  "../util.js" + v,
  "../geometry/projections.js" + v,
  "../geometry/measurements.js" + v,
  "intersections.js" + v,
);

const I = self.FRC.intersections;
self.onmessage = (ev) => {
  const { op, args } = ev.data;
  try {
    let result;
    if (op === "exact") result = I.exactGroup(args.geoms, args.items);
    else if (op === "estimate") result = I.estimateGroup(args.geoms, args.items, new Error(args.reason || "exact clipping failed"));
    else if (op === "touching") result = I.touching(args.geoms, args.features).map((f) => args.features.indexOf(f));
    else throw new Error("unknown operation " + op);
    self.postMessage({ ok: true, result });
  } catch (e) {
    self.postMessage({ ok: false, error: (e && e.message) || String(e) });
  }
};
