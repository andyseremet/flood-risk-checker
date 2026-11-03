// Builds the test boundaries from exact British National Grid squares, so the
// expected areas are known. Run: node make-fixtures.js
const fs = require("fs");
const path = require("path");
const proj4 = require("proj4");
globalThis.proj4 = proj4;
require("../js/config.js");
proj4.defs("EPSG:27700", globalThis.FRC.config.bngProj4);
const toWGS = ([e, n]) => proj4("EPSG:27700", "EPSG:4326", [e, n]).map((v) => Math.round(v * 1e9) / 1e9);
const sq = (e, n, s) => [[e, n], [e + s, n], [e + s, n + s], [e, n + s], [e, n]];
const out = (name, obj) => fs.writeFileSync(path.join(__dirname, "fixtures", name), typeof obj === "string" ? obj : JSON.stringify(obj, null, 1));
const wgsRing = (r) => r.map(toWGS);

// 1. 100 m x 100 m square written in BNG metres (exported from QGIS in EPSG:27700)
out("square-100m-bng.geojson", {
  type: "FeatureCollection",
  crs: { type: "name", properties: { name: "urn:ogc:def:crs:EPSG::27700" } },
  features: [{ type: "Feature", properties: { name: "Test square" }, geometry: { type: "Polygon", coordinates: [sq(430000, 430000, 100)] } }],
});
// 2. 200 m square with a 50 m square hole in WGS84: 40,000 - 2,500 = 37,500 m²
out("square-with-hole.geojson", {
  type: "Feature", properties: { name: "Square with hole" },
  geometry: { type: "Polygon", coordinates: [wgsRing(sq(430000, 430000, 200)), wgsRing(sq(430075, 430075, 50).reverse())] },
});
// 3. Two separate 100 m squares as one MultiPolygon: 20,000 m²
out("multipart.geojson", {
  type: "Feature", properties: { name: "Two fields" },
  geometry: { type: "MultiPolygon", coordinates: [[wgsRing(sq(430000, 430000, 100))], [wgsRing(sq(430300, 430000, 100))]] },
});
// 4. Self-intersecting "bow tie" (invalid)
out("bowtie-invalid.geojson", {
  type: "Feature", properties: {},
  geometry: { type: "Polygon", coordinates: [wgsRing([[430000, 430000], [430100, 430100], [430100, 430000], [430000, 430100], [430000, 430000]])] },
});
// 5. Empty collection
out("empty.geojson", { type: "FeatureCollection", features: [] });
// 6. KML with two placemarks: 100 m square and 50 m square = 12,500 m²
const kmlCoords = (r) => wgsRing(r).map(([x, y]) => `${x},${y},0`).join(" ");
out("two-parcels.kml", `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Test site</name>
<Placemark><name>North field</name><Polygon><outerBoundaryIs><LinearRing><coordinates>${kmlCoords(sq(430000, 430000, 100))}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>
<Placemark><name>South field</name><Polygon><outerBoundaryIs><LinearRing><coordinates>${kmlCoords(sq(430000, 429800, 50))}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>
</Document></kml>
`);
// site-shapefile.zip (150 m square, 22,500 m²) was built with Python pyshp from these coordinates:
console.log(JSON.stringify(wgsRing(sq(430000, 430000, 150))));
console.log("Fixtures written.");
