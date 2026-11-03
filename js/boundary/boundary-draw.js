// Site boundary drawing, editing and deleting on the map (Leaflet.draw).
// Keeps all parcels in one FeatureGroup and reports every change through onChange.
(function (root) {
  "use strict";
  const FRC = (root.FRC = root.FRC || {});

  const STYLE = { color: "#7a3db8", weight: 3, fillOpacity: 0.15, bubblingMouseEvents: false };
  let map = null, group = null, onChange = () => {}, busy = false, counter = 0;

  function nameOf(layer) { return layer._frcName || "Parcel"; }

  function addPolygonLayer(layer, name) {
    layer.setStyle && layer.setStyle(STYLE);
    layer.options.bubblingMouseEvents = false;
    layer._frcName = name || "Parcel " + ++counter;
    layer.bindTooltip(() => FRC.util.esc(nameOf(layer)), { sticky: true });
    group.addLayer(layer);
  }

  const draw = {
    init(leafletMap, opts = {}) {
      map = leafletMap;
      onChange = opts.onChange || onChange;
      group = new L.FeatureGroup().addTo(map);

      const control = new L.Control.Draw({
        position: "topleft",
        draw: {
          // showArea is off because Leaflet.draw's own area label is inaccurate
          // and breaks with Leaflet 1.9; areas are calculated in BNG instead.
          polygon: { allowIntersection: false, showArea: false, shapeOptions: STYLE,
            drawError: { color: "#b3261e", message: "Edges cannot cross. Click elsewhere." } },
          rectangle: { showArea: false, shapeOptions: STYLE },
          polyline: false, circle: false, marker: false, circlemarker: false,
        },
        edit: { featureGroup: group, poly: { allowIntersection: false } },
      });
      map.addControl(control);

      const E = L.Draw.Event;
      map.on(E.CREATED, (e) => { addPolygonLayer(e.layer); onChange("drawn"); });
      map.on(E.EDITED, () => onChange("edited"));
      map.on(E.DELETED, () => onChange("deleted"));
      // While drawing or editing, map clicks must not run a location check.
      [E.DRAWSTART, E.EDITSTART, E.DELETESTART].forEach((ev) => map.on(ev, () => { busy = true; }));
      [E.DRAWSTOP, E.EDITSTOP, E.DELETESTOP].forEach((ev) => map.on(ev, () => { setTimeout(() => { busy = false; }, 50); }));
      return group;
    },

    isBusy: () => busy,

    // Start drawing a new polygon from an outside button.
    startPolygon() { new L.Draw.Polygon(map, { allowIntersection: false, showArea: false, shapeOptions: STYLE }).enable(); },

    // Add validated WGS84 features. MultiPolygons are split so each part can be edited.
    addFeatures(features) {
      const added = [];
      features.forEach((f) => {
        const base = (f.properties && f.properties.name) || null;
        const polys = f.geometry.type === "MultiPolygon" ? f.geometry.coordinates : [f.geometry.coordinates];
        polys.forEach((coords, i) => {
          const latlngs = coords.map((ring) => ring.slice(0, -1).map(([lon, lat]) => [lat, lon]));
          const layer = L.polygon(latlngs, STYLE);
          addPolygonLayer(layer, base ? (polys.length > 1 ? `${base} (part ${i + 1})` : base) : null);
          added.push(layer);
        });
      });
      if (added.length) onChange("imported");
      return added;
    },

    // Current parcels as GeoJSON Features in WGS84.
    getFeatures() {
      return group.getLayers().map((layer) => {
        const f = layer.toGeoJSON(15);
        f.properties = { name: nameOf(layer) };
        return f;
      });
    },

    layers: () => group.getLayers(),
    removeLayer(layer) { group.removeLayer(layer); onChange("deleted"); },
    renameLayer(layer, name) { layer._frcName = name; onChange("renamed"); },
    clear() { group.clearLayers(); counter = 0; onChange("cleared"); },
    zoomTo(layer) {
      const b = (layer || group).getBounds();
      if (b.isValid()) map.fitBounds(b, { padding: [30, 30], maxZoom: 18 });
    },
  };

  FRC.boundaryDraw = draw;
})(typeof window !== "undefined" ? window : globalThis);
