# Flood Risk Checker

A prototype flood risk checker for analysts in the UK. Enter a postcode or click the map to see flood data for that spot, then download a PDF report. It is one HTML file with no build step.

## Run it

Use it at https://andyseremet.github.io/flood-risk-checker/ or open `index.html` in a browser. It needs an internet connection, because it calls public flood data services and loads three libraries from cdnjs: Leaflet (map), jsPDF (PDF) and html2canvas (map image in the PDF).

## What it shows

| Section | Where it comes from | Covers |
|---|---|---|
| Location | [postcodes.io](https://api.postcodes.io/docs/overview) | Whole UK |
| Flood zone | EA Flood Map for Planning, NRW Flood Map for Planning, SEPA Flood Maps | England, Wales, Scotland |
| Long-term risk band | EA Risk of Flooding from Rivers and Sea | England |
| Live warnings and alerts | [EA flood monitoring API](https://environment.data.gov.uk/flood-monitoring/doc/reference) | England |
| Nearest river gauges | EA flood monitoring API | England |

Northern Ireland flood map data is not open, so the app only shows the location there.

The **Data connections** panel tests each service when the page opens and shows whether this browser can reach it.

## Report options

Tick the sections to include, pick a search radius (1, 2 or 5 km), and add a reference, analyst name and notes. Sources and the disclaimer are always included.

## Licence and credits

Flood data from the Environment Agency, Natural Resources Wales and SEPA is used under the Open Government Licence v3.0. Map data © OpenStreetMap contributors. The EA live data API has no uptime guarantee and is not for safety-critical use.

## Next steps

- Check every service works from a real browser
- Add Wales and Scotland river levels
- Port to Python and package it
