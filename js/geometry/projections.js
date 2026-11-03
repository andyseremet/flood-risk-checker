// Coordinate transformation between WGS84 (EPSG:4326, used by the map and
// GeoJSON) and British National Grid (EPSG:27700, used for measurements).
// Requires the proj4 global (Proj4js).
(function (root) {
  "use strict";
  const FRC = (root.FRC = root.FRC || {});

  function proj() {
    const p = root.proj4;
    if (!p) throw new Error("Proj4js is not loaded");
    if (!p.defs("EPSG:27700")) p.defs("EPSG:27700", FRC.config.bngProj4);
    return p;
  }

  // Map every [x, y] position in a GeoJSON geometry through fn.
  function mapCoords(geom, fn) {
    const walk = (c) => (typeof c[0] === "number" ? fn(c) : c.map(walk));
    if (geom.type === "GeometryCollection") return { type: geom.type, geometries: geom.geometries.map((g) => mapCoords(g, fn)) };
    return { type: geom.type, coordinates: walk(geom.coordinates) };
  }

  const projections = {
    // [lon, lat] -> [easting, northing]
    toBNG(lonLat) { return proj()("EPSG:4326", "EPSG:27700", [lonLat[0], lonLat[1]]); },
    // [easting, northing] -> [lon, lat]
    toWGS84(en) { return proj()("EPSG:27700", "EPSG:4326", [en[0], en[1]]); },
    geometryToBNG(geom) { return mapCoords(geom, (c) => projections.toBNG(c)); },
    geometryToWGS84(geom) { return mapCoords(geom, (c) => projections.toWGS84(c)); },
    mapCoords,
  };

  FRC.projections = projections;
  if (typeof module !== "undefined" && module.exports) module.exports = projections;
})(typeof window !== "undefined" ? window : globalThis);
