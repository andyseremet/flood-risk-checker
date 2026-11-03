// Environmental map overlays (WMS images from EA, NRW and SEPA) and their toggles.
(function (root) {
  "use strict";
  const FRC = (root.FRC = root.FRC || {});

  // SEPA's WMS does not support Web Mercator (EPSG:3857) and its layer names
  // carry generated suffixes, so Scotland is drawn from the ArcGIS REST
  // "export" operation instead, which reprojects on request. SEPA only draws
  // these layers at 1:85,000 or closer, so the layer starts at zoom 13.
  const SEPA_MIN_ZOOM = 13;
  function sepaLayer(base, opts) {
    const Layer = L.TileLayer.extend({
      getTileUrl(c) {
        const size = this.getTileSize();
        const nw = this._map.unproject(c.scaleBy(size), c.z);
        const se = this._map.unproject(c.add([1, 1]).scaleBy(size), c.z);
        const a = L.CRS.EPSG3857.project(nw), b = L.CRS.EPSG3857.project(se);
        const q = new URLSearchParams({
          bbox: [a.x, b.y, b.x, a.y].join(","), bboxSR: "3857", imageSR: "3857",
          size: size.x + "," + size.y, dpi: "96", format: "png32", transparent: "true",
          layers: "show:" + FRC.mapLayers.sepaVisible.join(","), f: "image",
        });
        return base + "/export?" + q.toString();
      },
    });
    return new Layer("", { opacity: opts.opacity, crossOrigin: opts.crossOrigin, minZoom: SEPA_MIN_ZOOM, maxZoom: 19 });
  }

  FRC.mapLayers = {
    sepaVisible: [0, 1, 2], // River flooding high, medium, low likelihood
    sepaMinZoom: SEPA_MIN_ZOOM,
    init(map) {
      const A = FRC.config.api;
      const opts = { format: "image/png", transparent: true, opacity: 0.6, crossOrigin: true, minZoom: 10 };
      const layers = {
        ez: L.tileLayer.wms(A.eaZonesWms, { ...opts, layers: "Flood_Zones_2_3_Rivers_and_Sea" }),
        er: L.tileLayer.wms(A.eaRiskWms, { ...opts, layers: "rofrs_4band" }),
        // The surface water service draws only at 1:50,000 or closer.
        sw: L.tileLayer.wms(A.eaSurfaceWms, { ...opts, layers: "rofsw", minZoom: 14 }),
        res: L.tileLayer.wms(A.eaReservoirWms, { ...opts, layers: "Reservoir_Flood_Extents_Wet_Day" }),
        rec: L.tileLayer.wms(A.eaRecordedWms, { ...opts, layers: "Recorded_Flood_Outlines" }),
        w: L.tileLayer.wms(A.nrw, { ...opts, layers: A.nrwLayer }),
        s: sepaLayer(A.sepa, opts),
      };
      for (const k of Object.keys(layers)) {
        const box = document.getElementById("l-" + k);
        if (!box) continue;
        if (box.checked) layers[k].addTo(map);
        box.addEventListener("change", () => (box.checked ? layers[k].addTo(map) : map.removeLayer(layers[k])));
      }
      // The layers panel stays closed until the layers button is clicked.
      const legend = document.getElementById("legend");
      const toggle = document.getElementById("layersToggle");
      const close = document.getElementById("layersClose");
      if (legend) { L.DomEvent.disableClickPropagation(legend); L.DomEvent.disableScrollPropagation(legend); }
      if (legend && toggle) {
        L.DomEvent.disableClickPropagation(toggle);
        const setOpen = (open) => {
          legend.hidden = !open;
          toggle.setAttribute("aria-expanded", String(open));
          toggle.setAttribute("aria-label", open ? "Hide map layers" : "Show map layers");
        };
        toggle.addEventListener("click", () => setOpen(legend.hidden));
        if (close) close.addEventListener("click", () => { setOpen(false); toggle.focus(); });
        document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !legend.hidden) { setOpen(false); toggle.focus(); } });
      }
      return layers;
    },
  };
})(typeof window !== "undefined" ? window : globalThis);
