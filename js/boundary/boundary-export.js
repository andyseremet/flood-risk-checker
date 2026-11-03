// Exports the site boundary as GeoJSON (WGS84, RFC 7946) with each parcel's
// measurements in its properties.
(function (root) {
  "use strict";
  const FRC = (root.FRC = root.FRC || {});

  const exporter = {
    build(features, measured, siteName) {
      return {
        type: "FeatureCollection",
        name: siteName || "Site boundary",
        features: features.map((f, i) => {
          const m = measured && measured.parcels[i];
          return {
            type: "Feature",
            properties: {
              name: (f.properties && f.properties.name) || "Parcel " + (i + 1),
              site: siteName || undefined,
              area_m2: m ? Math.round(m.area * 100) / 100 : undefined,
              perimeter_m: m ? Math.round(m.perimeter * 100) / 100 : undefined,
              crs_note: "Coordinates WGS84 (EPSG:4326). Areas calculated in British National Grid (EPSG:27700).",
            },
            geometry: f.geometry,
          };
        }),
      };
    },

    download(features, measured, siteName) {
      const fc = exporter.build(features, measured, siteName);
      const blob = new Blob([JSON.stringify(fc, null, 2)], { type: "application/geo+json" });
      const a = document.createElement("a");
      const safe = (siteName || "site-boundary").replace(/[^a-z0-9-_]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "site-boundary";
      a.href = URL.createObjectURL(blob);
      a.download = safe + ".geojson";
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
    },
  };

  FRC.boundaryExport = exporter;
})(typeof window !== "undefined" ? window : globalThis);
