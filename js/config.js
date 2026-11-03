// Service addresses and fixed reference values. All services are public and need no key.
(function (root) {
  "use strict";
  const FRC = (root.FRC = root.FRC || {});

  FRC.config = {
    api: {
      postcode: "https://api.postcodes.io",
      eaFlood: "https://environment.data.gov.uk/flood-monitoring",
      eaZones: "https://environment.data.gov.uk/spatialdata/flood-map-for-planning-flood-zones/ogc/features/v1/collections/Flood_Zones_2_3_Rivers_and_Sea/items",
      eaZonesWms: "https://environment.data.gov.uk/spatialdata/flood-map-for-planning-flood-zones/wms",
      eaRiskWms: "https://environment.data.gov.uk/spatialdata/nafra2-risk-of-flooding-from-rivers-and-sea/wms",
      eaSurfaceWms: "https://environment.data.gov.uk/spatialdata/nafra2-risk-of-flooding-from-surface-water/wms",
      eaReservoir: "https://environment.data.gov.uk/spatialdata/reservoir-flood-extents-wet-day/ogc/features/v1/collections/Reservoir_Flood_Extents_Wet_Day/items",
      eaReservoirWms: "https://environment.data.gov.uk/spatialdata/reservoir-flood-extents-wet-day/wms",
      eaRecorded: "https://environment.data.gov.uk/spatialdata/recorded-flood-outlines/ogc/features/v1/collections/Recorded_Flood_Outlines/items",
      eaRecordedWms: "https://environment.data.gov.uk/spatialdata/recorded-flood-outlines/wms",
      nrw: "https://datamap.gov.wales/geoserver/ows",
      nrwLayer: "inspire-nrw:NRW_FLOODZONE_RIVERS_SEAS_MERGED",
      sepa: "https://map.sepa.org.uk/server/rest/services/Open/Flood_Maps/MapServer",
    },

    // SEPA Flood_Maps MapServer layer ids -> [source, likelihood]
    sepaLayers: {
      0: ["River", "High"], 1: ["River", "Medium"], 2: ["River", "Low"],
      3: ["Surface water", "High"], 4: ["Surface water", "Medium"], 5: ["Surface water", "Low"],
      6: ["Coastal", "High"], 7: ["Coastal", "Medium"], 8: ["Coastal", "Low"],
    },
    sepaMeaning: {
      High: "about 1 in 10 chance each year",
      Medium: "about 1 in 200 chance each year",
      Low: "about 1 in 1,000 chance each year",
    },
    zoneMeaning: {
      FZ3: "Flood Zone 3: high probability (1 in 100 or greater each year from rivers, 1 in 200 or greater from the sea).",
      FZ2: "Flood Zone 2: medium probability (between 1 in 1,000 and 1 in 100 each year from rivers).",
    },

    // Rough box around Great Britain and Northern Ireland, used to warn about
    // boundaries that are probably in the wrong place or coordinate system.
    ukBounds: { minLon: -9.0, maxLon: 2.1, minLat: 49.8, maxLat: 61.0 },

    // EPSG:27700 British National Grid. The 7-parameter Helmert shift is
    // accurate to a few metres; OSTN15 (sub-metre) is not used in the browser.
    bngProj4: "+proj=tmerc +lat_0=49 +lon_0=-2 +k=0.9996012717 +x_0=400000 +y_0=-100000 +ellps=airy +towgs84=446.448,-125.157,542.06,0.15,0.247,0.842,-20.489 +units=m +no_defs",

    sqmPerAcre: 4046.8564224,
  };
})(typeof window !== "undefined" ? window : globalThis);
