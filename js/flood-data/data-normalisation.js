// Turns each agency's flood polygons into one common shape:
// { group, key, label, rank, geometry } where rank orders classes from most to
// least severe within a group. Each agency keeps its own classification:
// England and Wales use planning Flood Zones; Scotland uses likelihood bands.
(function (root) {
  "use strict";
  const FRC = (root.FRC = root.FRC || {});

  const isPoly = (g) => g && (g.type === "Polygon" || g.type === "MultiPolygon");

  const normalise = {
    ea(features) {
      return features.filter((f) => isPoly(f.geometry)).map((f) => {
        const z = String((f.properties && f.properties.flood_zone) || "").toUpperCase();
        if (z === "FZ3") return { group: "England", key: "FZ3", label: "Flood Zone 3", rank: 1, geometry: f.geometry };
        if (z === "FZ2") return { group: "England", key: "FZ2", label: "Flood Zone 2", rank: 2, geometry: f.geometry };
        return { group: "England", key: "EA-other", label: "Mapped zone (unclassified: " + (z || "no value") + ")", rank: 3, geometry: f.geometry };
      });
    },

    // Reservoir flood extents: one class. The data carries no likelihood.
    eaReservoir(features) {
      return features.filter((f) => isPoly(f.geometry)).map((f) => (
        { group: "England: Reservoir", key: "RES", label: "Reservoir flood extent (if a reservoir failed)", rank: 1, geometry: f.geometry }));
    },

    // Recorded flood outlines: one class. Areas that have flooded before.
    eaRecorded(features) {
      return features.filter((f) => isPoly(f.geometry)).map((f) => (
        { group: "England: Recorded floods", key: "REC", label: "Recorded flood outline (flooded in the past)", rank: 1, geometry: f.geometry }));
    },

    nrw(features) {
      return features.filter((f) => isPoly(f.geometry)).map((f) => {
        const p = f.properties || {};
        const text = Object.entries(p).filter(([k]) => /zone|risk|type|class/i.test(k)).map(([, v]) => String(v)).join(" ");
        if (/3/.test(text)) return { group: "Wales", key: "W-FZ3", label: "Flood Zone 3", rank: 1, geometry: f.geometry };
        if (/2/.test(text)) return { group: "Wales", key: "W-FZ2", label: "Flood Zone 2", rank: 2, geometry: f.geometry };
        return { group: "Wales", key: "W-other", label: "Mapped flood zone (zone not stated in data)", rank: 3, geometry: f.geometry };
      });
    },

    sepa(features) {
      const order = { High: 1, Medium: 2, Low: 3 };
      const freq = { High: "1 in 10", Medium: "1 in 200", Low: "1 in 1,000" };
      return features.filter((f) => isPoly(f.geometry)).map((f) => {
        const meta = FRC.config.sepaLayers[f.properties && f.properties.sepaLayer];
        if (!meta) return null;
        const [src, lik] = meta;
        return { group: "Scotland: " + src, key: `${src}-${lik}`, label: `${lik} likelihood (${freq[lik]} each year)`, rank: order[lik], geometry: f.geometry };
      }).filter(Boolean);
    },
  };

  FRC.normalise = normalise;
  if (typeof module !== "undefined" && module.exports) module.exports = normalise;
})(typeof window !== "undefined" ? window : globalThis);
