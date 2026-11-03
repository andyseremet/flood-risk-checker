# Flood Risk Checker: phase 9 test plan

Live app: https://andyseremet.github.io/flood-risk-checker/
Test page: https://andyseremet.github.io/flood-risk-checker/diagnostics.html

This takes about 15 minutes. Check that the footer shows version **2026-11-03.11** or later. If it shows an older version, do a hard refresh (Ctrl+Shift+R, or Cmd+Shift+R on a Mac).

## Part 1. Automatic tests (2 minutes)

1. Open the test page and press **Run all tests**.
2. When it says "Finished", press **Copy report** and paste the report into the chat.

It covers every case in the spec's testing list:

| Spec case | How it is tested |
| --- | --- |
| Site outside the flood zones | Dunstable Downs chalk ridge |
| Site in Zone 2 / Zone 3 / several classes | York city centre by the River Ouse |
| Large site, partial coverage | 1 km square on the Thames at Blackfriars |
| Multipart polygons | Two York parcels |
| Polygon holes | York square with a hole |
| Wales and Scotland | Swansea (River Tawe), Perth (River Tay) |
| GeoJSON, KML and Shapefile import; GeoJSON export | The test files with known areas |
| Invalid polygons | A self-crossing shape and an empty file |
| Different coordinate systems | A British National Grid GeoJSON |
| API failures and timeouts | An unreachable service and a 1 ms timeout |

The report also shows which fields the live Wales and surface water data use. Those fields couldn't be checked from the build environment.

## Part 2. Checks by eye (10 minutes)

Use the York site (postcode YO1 9TA), drawn as a rough square around Kings Staith and the riverside.

1. **Map layers:** open the layers button and turn on each layer in turn. Note any layer that shows nothing when zoomed in close.
2. **Analysis:** press **Analyse site** and check that the shaded areas on the map match the flood zone layer.
3. **PDF:** download the report. Check that the three maps show the real map, not blank or grey boxes, and that the tables read correctly.
4. **Phone:** open the app on your phone, draw a small site and run it once.

## What to send back

- The copied report from Part 1.
- Screenshots of anything in Part 2 that looks wrong.
