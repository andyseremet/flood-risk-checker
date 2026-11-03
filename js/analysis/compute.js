// Runs the polygon measurements off the page, in a background worker, with a
// time limit. If exact clipping takes too long it is stopped and the areas are
// estimated from sample points instead. If the estimate also takes too long,
// the dataset reports a processing error rather than freezing the page.
// Where workers are not available (opened as a local file, or in Node tests)
// the same functions run directly.
(function (root) {
  "use strict";
  const FRC = (root.FRC = root.FRC || {});

  const LIMITS = { exact: 15000, estimate: 30000, touching: 15000 };
  let workerBroken = typeof Worker === "undefined" || (root.location && root.location.protocol === "file:");

  function workerUrl() {
    const tag = root.FRC_VERSION ? "?v=" + encodeURIComponent(root.FRC_VERSION) : "";
    return "js/analysis/analysis-worker.js" + tag;
  }

  class TooLong extends Error {}

  // One worker per job: a stuck job is ended by terminating its worker.
  function inWorker(op, args, limit) {
    return new Promise((resolve, reject) => {
      let w;
      try { w = new Worker(workerUrl()); } catch (e) { workerBroken = true; reject(e); return; }
      const done = (fn, v) => { clearTimeout(timer); w.terminate(); fn(v); };
      const timer = setTimeout(() => done(reject, new TooLong(`took longer than ${limit / 1000} s`)), limit);
      w.onmessage = (ev) => (ev.data.ok ? done(resolve, ev.data.result) : done(reject, new Error(ev.data.error)));
      w.onerror = (ev) => { ev.preventDefault(); workerBroken = true; done(reject, new Error("worker failed to start: " + (ev.message || "unknown"))); };
      w.postMessage({ op, args });
    });
  }

  const I = () => FRC.intersections;

  const compute = {
    LIMITS,
    get usingWorker() { return !workerBroken; },

    async analyseGroup(geoms, items) {
      if (workerBroken) return I().analyseGroup(geoms, items);
      let cause;
      try { return await inWorker("exact", { geoms, items }, LIMITS.exact); } catch (e) {
        if (/no area to analyse/.test(e.message)) throw e;
        if (workerBroken && !(e instanceof TooLong)) return I().analyseGroup(geoms, items);
        cause = e instanceof TooLong ? new Error("exact clipping " + e.message) : e;
      }
      try { return await inWorker("estimate", { geoms, items, reason: cause.message }, LIMITS.estimate); } catch (e) {
        if (e instanceof TooLong) throw new Error(`These flood polygons are too detailed to measure in the browser. Exact clipping took longer than ${LIMITS.exact / 1000} s and the estimate took longer than ${LIMITS.estimate / 1000} s.`);
        throw e;
      }
    },

    async touching(geoms, features) {
      if (workerBroken) return I().touching(geoms, features);
      try {
        const idx = await inWorker("touching", { geoms, features }, LIMITS.touching);
        return idx.map((i) => features[i]);
      } catch (e) {
        if (workerBroken && !(e instanceof TooLong)) return I().touching(geoms, features);
        return null; // names could not be listed in time
      }
    },
  };

  FRC.compute = compute;
})(typeof window !== "undefined" ? window : globalThis);
