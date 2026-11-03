# Flood Risk Checker

A browser-based tool for preliminary flood risk screening of UK development sites. Find a location, draw or import the site boundary, get its measurements, check public flood data, and download a PDF report.

It is plain HTML, CSS and JavaScript with no build step. It is a screening aid only, not a Flood Risk Assessment.

## Run it

Use it at https://andyseremet.github.io/flood-risk-checker/ (once GitHub Pages is on), or open `index.html` in a browser. It needs an internet connection, because it calls public flood data services and loads its libraries from CDNs.

## What it does

| Step | What you can do |
|---|---|
| 1. Find the location | Search a UK postcode with the magnifier on the map (checked for the right format), or click the map to drop a pin. With no boundary of your own, the **600 m area around the pin** becomes the site and is checked straight away |
| 2. Site boundary | Draw polygons or rectangles with the tools at the top left of the map (they replace the pin area), edit corners, delete, clear and redraw. Several parcels are supported |
| | Import GeoJSON, KML or a zipped Shapefile with the folder button on the map. Export the boundary as GeoJSON |
| | Area (m², hectares, acres), perimeter and centroid (latitude/longitude and British National Grid) |
| 3. Results | **Check** (under the map) intersects the boundary with each flood dataset. The results dashboard opens with a **summary**: a risk rating for each source of flooding (rivers, sea, surface water, groundwater, sewers, reservoirs, historic floods) and whether a full Flood Risk Assessment is likely to be needed, with next steps and a note on climate change. Then five sections, each of which can be hidden: **A** site information, **B** flood-zone assessment (areas and % of the site, shaded on the map, plus the zone and risk band at the centroid), **C** additional flood information (surface water, reservoir, recorded floods, groundwater), **D** live warnings and river gauges with readings and times, **E** assessment status of every dataset |
| 4. Report | PDF in the spec's structure, one section per page: 1 executive summary (document control box with version, prepared by and checked by; risk by source of flooding; "Is a full Flood Risk Assessment needed?" with next steps; climate change note; findings-at-a-glance table), 2 site location plan, 3 site boundary and measurements, 4 flood-zone assessment with a flood-zone map, 5 spatial intersection tables, 6 additional flood information, 7 warnings and gauges, 8 data status with retrieval times, sources, methodology, limitations and disclaimer. Company name and logo (remembered in this browser), reference and version on every page |

A progress panel at the top of the page shows while data is fetched and measured: a bar, a timer, and a list of steps with a spinning circle for each one still running and a tick when it is done. Each part of the page has an **i** button: hover for a tooltip, or click to show a short explanation. A note closes by itself when you move the map, scroll, or press anything else. Under the map are the Check, Download PDF report, Export GeoJSON and Clear all buttons. When a service fails or returns only part of its data, a round **try again** button appears after Check: it fetches only the failed parts again (point checks, site datasets and blocked data connections) and keeps everything that worked. Zoom is at the bottom left of the map.

The **Data connections** panel tests each public service when the page opens.

## How measurements work

Boundaries are kept in WGS84 (EPSG:4326) for the map and GeoJSON. For measuring, every corner is converted to British National Grid (EPSG:27700) with Proj4js, then area, perimeter and centroid are calculated on that flat grid in metres. This means they come from the real geometry, not the screen.

- Holes are subtracted from the area. The perimeter is the outer boundary only.
- Parcels that overlap each other are flagged, because the overlap would be counted twice.
- Files in British National Grid (common from QGIS) are detected and converted automatically.

## How the site analysis works

1. The site's bounding box is used to fetch flood polygons from the agency for the site's nation: EA Flood Zones 2 and 3 (OGC API, following its "next" pages), NRW Flood Map for Planning (WFS), or SEPA river, surface water and coastal extents (ArcGIS query, layers 0 to 8).
2. Each agency's own classes are kept: Flood Zones in England and Wales, likelihood bands (high, medium, low) for each source in Scotland.
3. The site parcels and the flood polygons are converted to British National Grid and intersected with Turf.
4. Polygons of the same class are merged, so overlaps count once. Classes are then made exclusive from most to least severe, so land in both a Zone 2 and a Zone 3 polygon counts once, as Zone 3. That overlap is reported.
5. Land with no mapped polygon is shown as "No Flood Zone 2 or 3 polygon mapped". It is never called Flood Zone 1.

Each dataset gets a status: Analysis completed, No mapped feature identified, Partial coverage (the service's result limit was reached), Not assessed, Service unavailable or Processing error.

| Example (from the spec) | Area | Site |
|---|---|---|
| Flood Zone 3 | 2,000 m² | 20% |
| Flood Zone 2 | 2,000 m² | 20% |
| No Flood Zone 2 or 3 polygon mapped | 6,000 m² | 60% |
| Total site | 10,000 m² | 100% |

This exact case is one of the automated tests.

### Other flood information (England)

| Dataset | How it is assessed |
|---|---|
| Reservoir flood extents (wet day) | Area and % of the site, plus the names of the reservoirs whose extent reaches it. A credible worst case with no likelihood. |
| Recorded flood outlines | Area and % of the site, plus the name, dates, source and cause of each recorded flood that reaches it. Not a complete record. |
| Risk of Flooding from Surface Water | Checked at the site centroid only. The EA publishes it as map images, not polygons, so its area cannot be measured. |
| Groundwater | Always "Not assessed": there is no open national groundwater flood dataset. |

These England datasets are shown as "Not assessed" for sites in Wales and Scotland. Scotland's surface water extents are already part of the SEPA analysis.

Classifications are shown in one neutral colour. Colour is kept for data status (for example Service unavailable), never to suggest that a site is safe or unsafe.

### Risk by source and the full FRA question

`js/reporting/assessment.js` turns the dataset results into one rating per source of flooding, using each agency's own classes: **High** is Flood Zone 3 or a high likelihood band, **Medium** is Flood Zone 2 or a medium band, **Low** is a low band. A source with nothing mapped is rated **None mapped**, never Low or Flood Zone 1. Sources the app cannot check (groundwater, sewers, and some sources outside England) are rated **Not assessed** with the reason.

The "Is a full Flood Risk Assessment needed?" answer uses the published triggers:

- England ([GOV.UK](https://www.gov.uk/guidance/flood-risk-assessment-the-sequential-test-for-applicants)): Flood Zone 2 or 3, or a site of 1 ha or more, means likely. A surface water band, a reservoir extent or a recorded flood means one may be needed.
- Wales (TAN15): Flood Zone 2 or 3 means a Flood Consequences Assessment is likely.
- Scotland (SEPA): a medium or high likelihood river or coastal extent means likely; a low likelihood extent or surface water means one may be needed.
- Northern Ireland: not covered, so the answer is "cannot tell".

When a key service fails, the answer is "cannot tell". The report always says that the local planning authority makes the final decision.

## Validation

A boundary is rejected, with a message saying why, when it is empty, has fewer than 3 corners, has zero area, crosses itself, or uses an unsupported coordinate system. Point and line shapes are ignored with a warning. Shapes outside the UK get a warning.

## Flood data sources

| Data | Source | Covers |
|---|---|---|
| Location | [postcodes.io](https://api.postcodes.io/docs/overview) | Whole UK |
| Flood zone | EA Flood Map for Planning, NRW Flood Map for Planning, SEPA Flood Maps | England, Wales, Scotland |
| Long-term risk band | EA Risk of Flooding from Rivers and Sea | England |
| Surface water | EA Risk of Flooding from Surface Water (WMS); SEPA surface water extents | England, Scotland |
| Reservoir flooding | EA Reservoir Flood Extents, wet day (OGC API) | England |
| Historic flooding | EA Recorded Flood Outlines (OGC API) | England |
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
  analysis/intersections.js     polygon intersection and area engine
  analysis/flood-analysis.js    fetches, normalises and analyses each dataset
  boundary/                     draw, import, export, validation
  geometry/                     projections (Proj4js), measurements
  flood-data/                   environment-agency, natural-resources-wales, sepa, data-normalisation
  dashboard/results.js          results and data status panels
  progress.js                   Progress panel (bar, timer, step list) while data loads
  reporting/assessment.js       Risk by source, full FRA question, climate note
  reporting/pdf-report.js       PDF report
tests/
  geometry.test.js              measurement and validation tests
  intersections.test.js         flood-zone intersection tests
  make-fixtures.js              builds the test boundaries
  fixtures/                     GeoJSON, KML and zipped Shapefile with known areas
```

The scripts are plain `<script>` files rather than ES modules, so the page also works when opened directly from disk.

## Libraries

Leaflet 1.9.4, Leaflet.draw 1.0.4, Turf 6.5.0 (validation and overlap checks), Proj4js 2.9.2, shpjs 4.0.4 (zipped Shapefiles, including the .prj) and jsPDF 2.5.1. Map images for the report are drawn by the app itself from the map's tiles, outlines and markers. KML is read with the browser's built-in DOMParser.

## Releasing a change

The page loads its scripts and styles with a version tag (`?v=1.0.0`), which is also shown in the page footer. Change it in `index.html` with each release (including the `FRC_VERSION` line, which the background worker uses) so browsers fetch the new files instead of a cached copy:

```bash
sed -i 's/1\.0\.0/NEW/g' index.html
```

The polygon measurements run in a background worker (`js/analysis/analysis-worker.js`, started by `js/analysis/compute.js`) so detailed flood polygons cannot freeze the page. Exact clipping gets 15 seconds; if it runs over, the areas are estimated from sample points (30 seconds); if that also runs over, the dataset shows a processing error. Opened as a local file, the browser blocks workers and the measurements run on the page instead.

## Tests

The app has no build step and nothing to install. The checks below are for developers only.

```bash
cd tests
npm install
npm test
```

The tests measure boundaries with known areas (a 100 m square in BNG, a square with a hole, a two-part polygon), check that invalid shapes are rejected, and check the flood-zone intersections (the 60/20/20 example, a site outside all zones, a whole site in Zone 3, overlapping polygons, overlapping parcels, a site with a hole, and SEPA likelihood bands). The site analysis tests replace the services with fixed responses and check the reservoir, recorded flood and surface water results, their statuses when nothing is mapped or a service is down, and the reasons given for datasets that are not assessed. The assessment tests check the risk ratings and the full FRA answer for England, Wales, Scotland and Northern Ireland, including sites with nothing mapped and a failed service.

## Known limitations

- The long-term risk band, surface water, live warnings and gauges are point checks at the site centroid. In live testing the Environment Agency's risk band service answered point queries with no band, even inside Flood Zone 3, so treat an empty risk band as "not available" and use the map layer instead.
- Surface water, reservoir and historic flooding are not added for Wales (NRW).
- The site's nation comes from its centroid. Near the England/Wales or England/Scotland border, where nearby postcodes are in different countries, the nation is "Unknown" and every agency is queried. A site that crosses a border is otherwise analysed only against its centroid's agency.
- If SEPA refuses one of its nine layers, the other layers are kept and the result is marked Partial coverage, naming the missing layer.
- Very large sites can hit a service's result limit. This is reported as Partial coverage.
- Address search is not supported, only postcodes.
- The BNG conversion uses a standard 7-parameter shift, accurate to a few metres. Grid areas can differ from ground areas by up to about 0.1%.
- If a dataset's polygons are too complex for exact clipping, its areas are estimated from about 10,000 sample points (roughly 1 to 2% error), marked "areas estimated", and not shaded on the map.
- Changing the boundary during an analysis discards the old result, but its downloads finish in the background.
- KMZ files are not supported. Save as KML instead.

## Licence and credits

Flood data from the Environment Agency, Natural Resources Wales and SEPA is used under the Open Government Licence v3.0. Map data © OpenStreetMap contributors. The EA live data API has no uptime guarantee and is not for safety-critical use.
