// Progress panel at the top of the page while data is fetched and processed:
// a bar for the share of steps done and a list of steps, each with a
// spinning circle while it runs and a tick when it is done.
// Jobs that run at the same time share the panel. It folds away shortly
// after every step is done.
(function (root) {
  "use strict";
  const FRC = (root.FRC = root.FRC || {});
  let steps = [], hideTimer = null;
  const $ = (id) => root.document && root.document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  function render() {
    const box = $("progress");
    if (!box || !steps.length) return;
    const done = steps.filter((s) => s.state !== "running").length;
    const pct = Math.round((100 * done) / steps.length);
    const finished = done === steps.length;
    box.hidden = false;
    box.querySelector(".progress-fill").style.width = Math.max(4, pct) + "%";
    box.setAttribute("aria-valuenow", String(pct));
    box.querySelector(".progress-title").textContent = finished ? "Done" : `Working… ${done} of ${steps.length} steps`;
    box.querySelector(".progress-steps").innerHTML = steps.map((s) =>
      `<li class="${s.state}"><span class="mark" aria-hidden="true">${s.state === "done" ? "✓" : s.state === "failed" ? "!" : ""}</span>` +
      `<span class="what">${esc(s.label)}${s.state === "failed" ? " (no result)" : ""}</span></li>`).join("");
    if (finished) {
      hideTimer = setTimeout(() => { box.hidden = true; steps = []; }, 2500);
    }
  }

  function start(label) {
    clearTimeout(hideTimer);
    // A new list starts once the last one has folded away; work that follows
    // straight on (the point checks, then the site) stays in one list.
    const step = { label, state: "running" };
    steps.push(step);
    render();
    return step;
  }
  function finish(step, ok) {
    step.state = ok ? "done" : "failed";
    render();
  }

  FRC.progress = {
    // Adds a named step that ticks off when the promise settles.
    track(promise, label) {
      const step = start(label);
      return Promise.resolve(promise).then((v) => { finish(step, true); return v; }, (e) => { finish(step, false); throw e; });
    },
  };
})(typeof window !== "undefined" ? window : globalThis);
