// Postcode lookup and reverse lookup through postcodes.io.
(function (root) {
  "use strict";
  const FRC = (root.FRC = root.FRC || {});

  // Standard UK postcode shape, e.g. "YO1 7HH", "SW1A 1AA". Spaces optional.
  const POSTCODE_RE = /^[A-Z]{1,2}[0-9][A-Z0-9]?\s*[0-9][A-Z]{2}$/i;

  FRC.location = {
    isPostcode: (s) => POSTCODE_RE.test(String(s || "").trim()),

    async lookupPostcode(pc) {
      const d = await FRC.util.getJSON(`${FRC.config.api.postcode}/postcodes/${encodeURIComponent(pc.trim())}`);
      return d.result;
    },

    // The nearest postcode gives the place name. Its country is used as the
    // point's nation only when every postcode within 2 km agrees: near the
    // England/Wales or England/Scotland border the nearest one can be over
    // the border, so a mixed answer gives "Unknown" and every agency is asked.
    async reverseLookup(lat, lon) {
      try {
        const d = await FRC.util.getJSON(`${FRC.config.api.postcode}/postcodes?lon=${lon}&lat=${lat}&limit=10&radius=2000`);
        const list = (d.result || []).filter(Boolean);
        if (!list.length) return null;
        const countries = [...new Set(list.map((r) => r.country).filter(Boolean))];
        return { ...list[0], nation: countries.length === 1 ? countries[0] : "Unknown", nearBorder: countries.length > 1 };
      } catch { return null; }
    },

    nationOf(place) {
      if (!place) return "Unknown";
      return place.nation || place.country || "Unknown";
    },
  };
})(typeof window !== "undefined" ? window : globalThis);
