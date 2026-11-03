// Progress bar at the top of the page while data is fetched and processed.
// Jobs add the number of steps they will take and tick each one off; jobs
// that run at the same time share the bar. It hides once every step is done.
(function (root) {
  "use strict";
  const FRC = (root.FRC = root.FRC || {});
  let total = 0, done = 0, hideTimer = null;
  const el = () => root.document && root.document.getElementById("progress");

  function render(label) {
    const box = el();
    if (!box || !total) return;
    clearTimeout(hideTimer);
    const pct = total ? Math.min(100, Math.round((100 * done) / total)) : 0;
    box.hidden = false;
    box.querySelector(".progress-fill").style.width = Math.max(4, pct) + "%";
    box.setAttribute("aria-valuenow", String(pct));
    if (label) box.querySelector(".progress-label").textContent = label;
    if (done >= total) {
      box.querySelector(".progress-label").textContent = "Done";
      hideTimer = setTimeout(() => { box.hidden = true; total = 0; done = 0; }, 700);
    }
  }

  FRC.progress = {
    // A job will take n more steps.
    add(n, label) { total += n; render(label); },
    // One step finished.
    tick(label) { done = Math.min(total, done + 1); render(label); },
    // Wraps a promise so it ticks once when it settles.
    // label says what is running, e.g. "Checking flood zones…".
    track(promise, label) { FRC.progress.add(1, label); return Promise.resolve(promise).finally(() => FRC.progress.tick()); },
  };
})(typeof window !== "undefined" ? window : globalThis);
