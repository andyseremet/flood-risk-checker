// Natural Resources Wales: Flood Map for Planning (rivers and sea) via DataMapWales WFS.
(function (root) {
  "use strict";
  const FRC = (root.FRC = root.FRC || {});

  FRC.nrw = {
    async zonesInBox(bbox, { max = 1000 } = {}) {
      const A = FRC.config.api;
      const url = `${A.nrw}?service=WFS&version=1.0.0&request=GetFeature&typename=${encodeURIComponent(A.nrwLayer)}&outputFormat=json&srsName=EPSG:4326&bbox=${bbox.join(",")},EPSG:4326&maxFeatures=${max}`;
      const r = await FRC.util.getJSON(url, 30000);
      const features = Array.isArray(r.features) ? r.features : [];
      return { features, partial: features.length >= max, retrieved: new Date() };
    },

    async zoneAtPoint(lat, lon) {
      const A = FRC.config.api, d = 0.0005;
      const url = `${A.nrw}?service=WFS&version=1.0.0&request=GetFeature&typename=${encodeURIComponent(A.nrwLayer)}&outputFormat=json&srsName=EPSG:4326&bbox=${lon - d},${lat - d},${lon + d},${lat + d},EPSG:4326&maxFeatures=50`;
      const r = await FRC.util.getJSON(url);
      const hits = (r.features || []).filter((f) => FRC.util.inGeometry(lon, lat, f.geometry));
      const props = hits.map((f) => f.properties || {});
      const text = props.map((p) => Object.entries(p).filter(([k]) => /zone|risk|source|type/i.test(k)).map(([, v]) => v).join(" ")).join(" ");
      // Do not infer Flood Zone 1 from an empty WFS response.
      const zone = /3/.test(text) ? "Flood Zone 3" : /2/.test(text) ? "Flood Zone 2" : hits.length ? "In a mapped flood zone" : "No mapped polygon identified";
      return { zone, hits: props, matchedFeatures: hits.length, retrieved: new Date() };
    },
  };
})(typeof window !== "undefined" ? window : globalThis);
