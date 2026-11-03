# Flood Risk Checker

A browser-based tool for preliminary flood risk screening of UK development sites. Find a location, draw or import the site boundary, get its measurements, check public flood data, and download a PDF report.

It is plain HTML, CSS and JavaScript with no build step. It is a screening aid only, not a Flood Risk Assessment.

## Run it

Use it at https://andyseremet.github.io/flood-risk-checker/ (once GitHub Pages is on), or open `index.html` in a browser. It needs an internet connection, because it calls public flood data services and loads its libraries from CDNs.

## What it does

| Step | What you can do |
|---|---|
| 1. Find the location | Search a UK postcode (checked for the right format) or click the map |
| 2. Site boundary | Draw polygons or rectangles, edit corners, delete, clear and redraw. Several parcels are supported |
| | Import GeoJSON, KML or a zipped Shapefile. Export the boundary as GeoJSON |
| | Area (m², hectares, acres), perimeter and centroid (latitude/longitude and British National Grid) |
| 3. Flood data | Flood zone, long-term risk band, live warnings and river gauges at the site centroid or clicked point |
| 4. Report | PDF with the sections you tick, data status, sources and limitations |

The **Data connections** panel tests each public service when the page opens.

## How measurements work

Boundaries are kept in WGS84 (EPSG:4326) for the map and GeoJSON. For measuring, every corner is converted to British National Grid (EPSG:27700) with Proj4js, then area, perimeter and centroid are calculated on that flat grid in metres. This means they come from the real geometry, not the screen.

- Holes are subtracted from the area. The perimeter is the outer boundary only.
- Parcels that overlap each other are flagged, because the overlap would be counted twice.
- Files in British National Grid (common from QGIS) are detected and converted automatically.

## Validation

A boundary is rejected, with a message saying why, when it is empty, has fewer than 3 corners, has zero area, crosses itself, or uses an unsupported coordinate system. Point and line shapes are ignored with a warning. Shapes outside the UK get a warning.

## Flood data sources

| Data | Source | Covers |
|---|---|---|
| Location | [postcodes.io](https://api.postcodes.io/docs/overview) | Whole UK |
| Flood zone | EA Flood Map for Planning, NRW Flood Map for Planning, SEPA Flood Maps | England, Wales, Scotland |
| Long-term risk band | EA Risk of Flooding from Rivers and Sea | England |
| Live warnings and river gauges | [EA flood monitoring API](https://environment.data.gov.uk/flood-monitoring/doc/reference) | England |

A missing result is never shown as low risk. Each dataset gets a status: Data retrieved, No mapped feature identified, Not assessed or Service unavailable. Northern Ireland flood map data is not open, so it is not assessed.

## Project structure

```text
index.html
assets/css/style.css
js/
  config.js                     service addresses and constants
  util.js                       shared helpers
  app.js                        wires the modules together
  map/map.js, map-layers.js     basemap, marker, flood overlays
  location/location-search.js   postcodes.io lookups
  boundary/                     draw, import, export, validation
  geometry/                     projections (Proj4js), measurements
  flood-data/                   environment-agency, natural-resources-wales, sepa
  dashboard/results.js          results and data status panels
  reporting/pdf-report.js       PDF report
tests/
  geometry.test.js              measurement and validation tests
  make-fixtures.js              builds the test boundaries
  fixtures/                     GeoJSON, KML and zipped Shapefile with known areas
```

The scripts are plain `<script>` files rather than ES modules, so the page also works when opened directly from disk.

## Libraries

Leaflet 1.9.4, Leaflet.draw 1.0.4, Turf 6.5.0 (validation and overlap checks), Proj4js 2.9.2, shpjs 4.0.4 (zipped Shapefiles, including the .prj), jsPDF 2.5.1 and html2canvas 1.4.1. KML is read with the browser's built-in DOMParser.

## Tests

```bash
cd tests
npm install
npm test
```

The tests measure boundaries with known areas (a 100 m square in BNG, a square with a hole, a two-part polygon) and check that invalid shapes are rejected.

## Known limitations

- Flood data is still checked at one point (the site centroid). Working out how much of the site falls in each flood zone is the next phase.
- Address search is not supported yet, only postcodes.
- The BNG conversion uses a standard 7-parameter shift, accurate to a few metres. Grid areas can differ from ground areas by up to about 0.1%.
- KMZ files are not supported. Save as KML instead.

## Licence and credits

Flood data from the Environment Agency, Natural Resources Wales and SEPA is used under the Open Government Licence v3.0. Map data © OpenStreetMap contributors. The EA live data API has no uptime guarantee and is not for safety-critical use.
