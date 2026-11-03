// Reads site boundaries from files: GeoJSON (.geojson/.json), KML (.kml) and
// zipped Shapefile (.zip). Returns parsed GeoJSON for boundary-validation.
// KML is parsed with the browser's DOMParser; Shapefiles with the shp global (shpjs),
// which also reads the .prj file and converts to WGS84.
(function (root) {
  "use strict";
  const FRC = (root.FRC = root.FRC || {});

  function parseKmlCoords(text) {
    return String(text || "").trim().split(/\s+/).filter(Boolean).map((t) => t.split(",").slice(0, 2).map(Number));
  }

  const imports = {
    parseGeoJSON(text) {
      try { return JSON.parse(text); } catch { throw new Error("The file is not valid GeoJSON (it could not be read as JSON)."); }
    },

    parseKML(text) {
      const doc = new DOMParser().parseFromString(text, "application/xml");
      if (doc.getElementsByTagName("parsererror").length) throw new Error("The KML file could not be read. It may be damaged or not KML.");
      const features = [];
      const placemarks = Array.from(doc.getElementsByTagNameNS("*", "Placemark"));
      const containers = placemarks.length ? placemarks : [doc.documentElement];
      containers.forEach((pm, i) => {
        const nameEl = pm.getElementsByTagNameNS("*", "name")[0];
        const name = nameEl && nameEl.parentNode === pm ? nameEl.textContent.trim() : null;
        const polys = Array.from(pm.getElementsByTagNameNS("*", "Polygon")).map((poly) => {
          const ringOf = (tag) => Array.from(poly.getElementsByTagNameNS("*", tag)).map((b) => {
            const c = b.getElementsByTagNameNS("*", "coordinates")[0];
            return parseKmlCoords(c && c.textContent);
          });
          return [...ringOf("outerBoundaryIs"), ...ringOf("innerBoundaryIs")];
        }).filter((r) => r.length);
        if (!polys.length) return;
        const geometry = polys.length === 1 ? { type: "Polygon", coordinates: polys[0] } : { type: "MultiPolygon", coordinates: polys };
        features.push({ type: "Feature", properties: { name: name || "Placemark " + (i + 1) }, geometry });
      });
      if (!features.length) throw new Error("No polygons were found in the KML file. Only Polygon shapes can be imported.");
      return { type: "FeatureCollection", features };
    },

    async parseShapefileZip(arrayBuffer) {
      if (!root.shp) throw new Error("The Shapefile reader did not load. Check your internet connection.");
      let out;
      try { out = await root.shp(arrayBuffer); } catch (e) {
        throw new Error("The zipped Shapefile could not be read. It must contain at least the .shp, .shx and .dbf files (and ideally .prj). " + (e && e.message ? "(" + e.message + ")" : ""));
      }
      // A zip with several layers returns an array of FeatureCollections.
      const list = Array.isArray(out) ? out : [out];
      return { type: "FeatureCollection", features: list.flatMap((fc) => fc.features || []) };
    },

    // Read a File from an <input type=file> and return parsed GeoJSON.
    async readFile(file) {
      const name = file.name.toLowerCase();
      if (name.endsWith(".zip")) return imports.parseShapefileZip(await file.arrayBuffer());
      if (name.endsWith(".kml")) return imports.parseKML(await file.text());
      if (name.endsWith(".geojson") || name.endsWith(".json")) return imports.parseGeoJSON(await file.text());
      if (name.endsWith(".kmz")) throw new Error("KMZ files are not supported yet. In Google Earth, save the place as .kml instead.");
      if (name.endsWith(".shp")) throw new Error("Please zip the Shapefile parts (.shp, .shx, .dbf, .prj) together and upload the .zip.");
      throw new Error("Unsupported file type. Use .geojson, .json, .kml or a zipped Shapefile (.zip).");
    },
  };

  FRC.boundaryImport = imports;
  if (typeof module !== "undefined" && module.exports) module.exports = imports;
})(typeof window !== "undefined" ? window : globalThis);
