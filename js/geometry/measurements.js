// Site measurements. Every polygon is first transformed to British National
// Grid (EPSG:27700); area, perimeter and centroid are then calculated on that
// flat grid in metres, from the actual vertices (not from the screen).
(function (root) {
  "use strict";
  const FRC = (root.FRC = root.FRC || {});

  // Signed shoelace area of a ring of [x, y] in metres. Positive = anticlockwise.
  function ringSignedArea(ring) {
    let a = 0;
    for (let i = 0, n = ring.length - 1; i < n; i++) a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
    return a / 2;
  }
  function ringLength(ring) {
    let l = 0;
    for (let i = 0; i < ring.length - 1; i++) l += Math.hypot(ring[i + 1][0] - ring[i][0], ring[i + 1][1] - ring[i][1]);
    return l;
  }
  // Area-weighted centroid contribution of a ring: returns [sumX, sumY, area].
  function ringMoments(ring) {
    let cx = 0, cy = 0, a = 0;
    for (let i = 0; i < ring.length - 1; i++) {
      const [x0, y0] = ring[i], [x1, y1] = ring[i + 1];
      const f = x0 * y1 - x1 * y0;
      a += f; cx += (x0 + x1) * f; cy += (y0 + y1) * f;
    }
    return [cx / 6, cy / 6, a / 2];
  }

  function polygonsOf(geom) {
    if (geom.type === "Polygon") return [geom.coordinates];
    if (geom.type === "MultiPolygon") return geom.coordinates;
    return [];
  }

  // Measure one geometry that is already in BNG metres.
  function measureBNG(geom) {
    let area = 0, perimeter = 0, holePerimeter = 0, mx = 0, my = 0, holes = 0, parts = 0;
    for (const poly of polygonsOf(geom)) {
      parts++;
      poly.forEach((ring, i) => {
        // Outer ring adds area, holes subtract it, whatever the winding order.
        const sign = i === 0 ? 1 : -1;
        const [sx, sy, sa] = ringMoments(ring);
        const k = Math.sign(sa) || 1;
        area += sign * Math.abs(sa);
        mx += sign * sx * k;
        my += sign * sy * k;
        if (i === 0) perimeter += ringLength(ring);
        else { holes++; holePerimeter += ringLength(ring); }
      });
    }
    const centroid = area > 0 ? [mx / area, my / area] : null;
    return { area, perimeter, holePerimeter, centroid, holes, parts };
  }

  const measurements = {
    ringSignedArea,
    ringLength,
    measureBNG,

    // features: array of GeoJSON Features with Polygon/MultiPolygon in WGS84.
    // Returns per-parcel and whole-site measurements.
    measureSite(features) {
      const P = FRC.projections;
      const parcels = features.map((f, i) => {
        const bng = P.geometryToBNG(f.geometry);
        const m = measureBNG(bng);
        return { index: i, name: (f.properties && f.properties.name) || "Parcel " + (i + 1), ...m };
      });
      const area = parcels.reduce((s, p) => s + p.area, 0);
      const perimeter = parcels.reduce((s, p) => s + p.perimeter, 0);
      let centroidBNG = null;
      if (area > 0) {
        const x = parcels.reduce((s, p) => s + (p.centroid ? p.centroid[0] * p.area : 0), 0) / area;
        const y = parcels.reduce((s, p) => s + (p.centroid ? p.centroid[1] * p.area : 0), 0) / area;
        centroidBNG = [x, y];
      }
      const centroidWGS = centroidBNG ? P.toWGS84(centroidBNG) : null;
      return {
        parcels,
        area,
        hectares: area / 10000,
        acres: area / FRC.config.sqmPerAcre,
        perimeter,
        holes: parcels.reduce((s, p) => s + p.holes, 0),
        centroidBNG,
        centroidWGS, // [lon, lat]
      };
    },
  };

  FRC.measurements = measurements;
  if (typeof module !== "undefined" && module.exports) module.exports = measurements;
})(typeof window !== "undefined" ? window : globalThis);
