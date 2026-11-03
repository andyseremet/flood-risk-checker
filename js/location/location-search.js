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

    async reverseLookup(lat, lon) {
      try {
        const d = await FRC.util.getJSON(`${FRC.config.api.postcode}/postcodes?lon=${lon}&lat=${lat}&limit=1&radius=1000`);
        return d.result && d.result[0] ? d.result[0] : null;
      } catch { return null; }
    },
  };
})(typeof window !== "undefined" ? window : globalThis);
