// Progress panel at the top of the page while data is fetched and processed:
// a bar for the share of steps done, a timer, and a list of steps that ticks
// each one off as it finishes (a bar shows on the steps still running).
// Jobs that run at the same time share the panel. It folds away shortly
// after every step is done.
(function (root) {
  "use strict";
  const FRC = (root.FRC = root.FRC || {});
  let steps = [], started = 0, clock = null, hideTimer = null;
  const $ = (id) => root.document && root.document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const secs = () => Math.max(0, Math.round((Date.now() - started) / 1000));
  const fmt = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  function render() {
    const box = $("progress");
    if (!box || !steps.length) return;
    const done = steps.filter((s) => s.state !== "running").length;
    const pct = Math.round((100 * done) / steps.length);
    const finished = done === steps.length;
    box.hidden = false;
    box.querySelector(".progress-fill").style.width = Math.max(4, pct) + "%";
    box.setAttribute("aria-valuenow", String(pct));
    box.querySelector(".progress-title").textContent = finished ? `Done in ${fmt(secs())}` : `Working… ${done} of ${steps.length} steps`;
    box.querySelector(".progress-time").textContent = fmt(secs());
    box.querySelector(".progress-steps").innerHTML = steps.map((s) =>
      `<li class="${s.state}"><span class="mark" aria-hidden="true">${s.state === "done" ? "✓" : s.state === "failed" ? "!" : ""}</span>` +
      `<span class="what">${esc(s.label)}${s.state === "failed" ? " (no result)" : ""}</span>` +
      `<span class="took">${s.state === "running" ? '<span class="mini"></span>' : fmt(s.took)}</span></li>`).join("");
    if (finished) {
      clearInterval(clock); clock = null;
      hideTimer = setTimeout(() => { box.hidden = true; steps = []; }, 2500);
    }
  }

  function start(label) {
    clearTimeout(hideTimer);
    // A new list starts once the last one has folded away; work that follows
    // straight on (the point checks, then the site) stays in one list.
    if (!steps.length) started = Date.now();
    if (!clock) clock = setInterval(() => { const t = $("progress"); if (t) t.querySelector(".progress-time").textContent = fmt(secs()); }, 1000);
    const step = { label, state: "running", t0: Date.now(), took: 0 };
    steps.push(step);
    render();
    return step;
  }
  function finish(step, ok) {
    step.state = ok ? "done" : "failed";
    step.took = Math.round((Date.now() - step.t0) / 1000);
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
