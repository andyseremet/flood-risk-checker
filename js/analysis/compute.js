// Runs the polygon measurements off the page, in a background worker, with a
// time limit. If exact clipping takes too long it is stopped and the areas are
// estimated from sample points instead. If the estimate also takes too long,
// the dataset reports a processing error rather than freezing the page.
// Where workers are not available (opened as a local file, or in Node tests)
// the same functions run directly.
(function (root) {
  "use strict";
  const FRC = (root.FRC = root.FRC || {});

  const LIMITS = { exact: 15000, estimate: 30000, touching: 15000, load: 30000 };
  // Measurements run on the page only where workers cannot run at all (a page
  // opened as a local file, or a browser without workers). A worker that fails
  // to start is retried; it never switches the page to on-page measuring,
  // which could freeze it on detailed polygons.
  const onPage = typeof Worker === "undefined" || (root.location && root.location.protocol === "file:");

  function workerUrl() {
    const tag = root.FRC_VERSION ? "?v=" + encodeURIComponent(root.FRC_VERSION) : "";
    return "js/analysis/analysis-worker.js" + tag;
  }

  class TooLong extends Error {}
  class NoStart extends Error {}

  // One worker per job: a stuck job is ended by terminating its worker. The
  // job's time limit starts once the worker has loaded its scripts, so a slow
  // download does not use it up.
  function once(op, args, limit) {
    return new Promise((resolve, reject) => {
      let w;
      try { w = new Worker(workerUrl()); } catch (e) { reject(new NoStart(e.message)); return; }
      let timer = setTimeout(() => done(reject, new NoStart(`its scripts did not load within ${LIMITS.load / 1000} s`)), LIMITS.load);
      const done = (fn, v) => { clearTimeout(timer); w.terminate(); fn(v); };
      w.onmessage = (ev) => {
        const d = ev.data;
        if (d.ready) {
          clearTimeout(timer);
          timer = setTimeout(() => done(reject, new TooLong(`took longer than ${limit / 1000} s`)), limit);
          w.postMessage({ op, args });
          return;
        }
        d.ok ? done(resolve, d.result) : done(reject, new Error(d.error));
      };
      w.onerror = (ev) => { ev.preventDefault(); done(reject, new NoStart(ev.message || "it failed to start")); };
    });
  }
  async function inWorker(op, args, limit) {
    try { return await once(op, args, limit); } catch (e) {
      if (!(e instanceof NoStart)) throw e;
      try { return await once(op, args, limit); } catch (e2) {
        if (e2 instanceof NoStart) throw new Error("The measuring could not start, because " + e2.message + ". Check the connection and press Analyse site again.");
        throw e2;
      }
    }
  }

  const I = () => FRC.intersections;

  const compute = {
    LIMITS,
    get usingWorker() { return !onPage; },

    async analyseGroup(geoms, items) {
      if (onPage) return I().analyseGroup(geoms, items);
      let cause;
      try { return await inWorker("exact", { geoms, items }, LIMITS.exact); } catch (e) {
        if (/no area to analyse|could not start/.test(e.message)) throw e;
        cause = e instanceof TooLong ? new Error("exact clipping " + e.message) : e;
      }
      try { return await inWorker("estimate", { geoms, items, reason: cause.message }, LIMITS.estimate); } catch (e) {
        if (e instanceof TooLong) throw new Error(`These flood polygons are too detailed to measure in the browser. Exact clipping took longer than ${LIMITS.exact / 1000} s and the estimate took longer than ${LIMITS.estimate / 1000} s.`);
        throw e;
      }
    },

    async touching(geoms, features) {
      if (onPage) return I().touching(geoms, features);
      try {
        const idx = await inWorker("touching", { geoms, features }, LIMITS.touching);
        return idx.map((i) => features[i]);
      } catch { return null; } // names could not be listed in time
    },
  };

  FRC.compute = compute;
})(typeof window !== "undefined" ? window : globalThis);
