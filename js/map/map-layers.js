// Environmental map overlays (WMS images from EA, NRW and SEPA) and their toggles.
(function (root) {
  "use strict";
  const FRC = (root.FRC = root.FRC || {});

  FRC.mapLayers = {
    init(map) {
      const A = FRC.config.api;
      const opts = { format: "image/png", transparent: true, opacity: 0.6, crossOrigin: true, minZoom: 10 };
      const layers = {
        ez: L.tileLayer.wms(A.eaZonesWms, { ...opts, layers: "Flood_Zones_2_3_Rivers_and_Sea" }),
        er: L.tileLayer.wms(A.eaRiskWms, { ...opts, layers: "rofrs_4band" }),
        w: L.tileLayer.wms(A.nrw, { ...opts, layers: A.nrwLayer }),
        s: L.tileLayer.wms(A.sepaWms, { ...opts, layers: "0,1,2" }),
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
