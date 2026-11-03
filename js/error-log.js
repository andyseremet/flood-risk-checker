// Error log: a list of every part that failed (a point check, a site dataset,
// a data connection or a map layer), when it failed, the message the service
// gave, a plain hint, and whether it later worked. The app calls sync() with
// the parts failing right now; a part that drops off the list is marked as
// fixed (after Try again) or as replaced (a newer check ran). "Copy log"
// copies the whole list as text, with the app version and browser, so it can
// be shared when reporting a problem.
(function (root) {
  "use strict";
  const FRC = (root.FRC = root.FRC || {});
  const $ = (id) => root.document && root.document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const hhmmss = (d) => d.toLocaleTimeString("en-GB", { hour12: false });

  let entries = []; // newest first: { key, what, message, at, tries, fixed, fixedHow, once }

  // A short, plain explanation of a technical error message.
  function hint(message) {
    const m = String(message || "");
    if (/timed? ?out|took too long|abort/i.test(m)) return "The service was slow to answer. Trying again usually works.";
    if (/failed to fetch|networkerror|load failed|network/i.test(m)) return "The browser could not reach the service. It may be down for a moment, or a network, firewall or browser extension may be blocking it.";
    if (/\b(50[0-9])\b/.test(m)) return "The service had a problem on its side. Try again in a minute.";
    if (/\b429\b/.test(m)) return "The service is limiting requests. Wait a minute, then try again.";
    if (/\b40[34]\b/.test(m)) return "The service refused or could not find the request. If it keeps happening, the service address may have changed.";
    if (/partial|only part/i.test(m)) return "Only part of the data came back, so areas may be under-counted.";
    if (/tile/i.test(m)) return "Some map images did not load. The checks and the report are not affected.";
    return "";
  }

  const log = {
    hint,
    entries: () => entries.slice(),
    active: () => entries.filter((e) => !e.fixed && !e.once).length,

    // failing: [{ key, what, message }] for every part failing now.
    // retried: true when this follows Try again.
    sync(failing, { retried = false } = {}) {
      const now = new Date();
      const keys = new Set(failing.map((f) => f.key));
      entries.forEach((e) => {
        if (!e.fixed && !e.once && !keys.has(e.key)) { e.fixed = now; e.fixedHow = retried ? "Worked after trying again" : "Replaced by a newer check"; }
      });
      failing.forEach((f) => {
        const open = entries.find((e) => e.key === f.key && !e.fixed && !e.once);
        if (open) {
          if (retried) open.tries++;
          open.message = f.message || open.message;
        } else entries.unshift({ key: f.key, what: f.what, message: f.message || "", at: now, tries: 0, fixed: null, once: false });
      });
      render();
    },

    // A one-off problem that Try again cannot fix (for example a postcode lookup).
    note(what, message) {
      entries.unshift({ key: "once:" + Date.now(), what, message: message || "", at: new Date(), tries: 0, fixed: null, once: true });
      render();
    },

    clear() { entries = []; render(); },

    text() {
      const lines = [`Flood Risk Checker ${root.FRC_VERSION || ""} error log, copied ${new Date().toLocaleString("en-GB")}`,
        `Browser: ${(root.navigator && root.navigator.userAgent) || "unknown"}`, ""];
      if (!entries.length) lines.push("No errors.");
      entries.slice().reverse().forEach((e) => {
        lines.push(`${hhmmss(e.at)}  ${e.what}`);
        if (e.message) lines.push(`  Message: ${e.message}`);
        const h = hint(e.message); if (h) lines.push(`  Hint: ${h}`);
        if (e.tries) lines.push(`  Tried again: ${e.tries} time${e.tries === 1 ? "" : "s"}`);
        lines.push("  Status: " + (e.fixed ? `${e.fixedHow} at ${hhmmss(e.fixed)}` : e.once ? "Not retried (run it again yourself)" : "Still failing"));
      });
      return lines.join("\n");
    },
  };

  function render() {
    const wrap = $("errLog");
    if (!wrap) return;
    const open = entries.filter((e) => !e.fixed && !e.once).length;
    const oneOff = entries.filter((e) => e.once).length;
    wrap.hidden = entries.length === 0;
    const btn = $("errLogToggle");
    const n = open + oneOff;
    btn.textContent = n ? `${n} problem${n === 1 ? "" : "s"}` : "Error log";
    btn.classList.toggle("bad", open > 0);
    $("errLogList").innerHTML = entries.map((e) => {
      const h = hint(e.message);
      const status = e.fixed ? `<span class="pill ok">Fixed</span>` : e.once ? `<span class="pill neutral">One-off</span>` : `<span class="pill bad">Failing</span>`;
      return `<li class="${e.fixed ? "fixed" : ""}"><div class="err-head"><span class="mono">${hhmmss(e.at)}</span> <strong>${esc(e.what)}</strong> ${status}</div>` +
        (e.message ? `<div class="err-msg mono">${esc(e.message)}</div>` : "") +
        (h ? `<div class="err-hint">${esc(h)}</div>` : "") +
        (e.fixed ? `<div class="err-hint">${esc(e.fixedHow)} at ${hhmmss(e.fixed)}${e.tries ? ` (tried ${e.tries} time${e.tries === 1 ? "" : "s"})` : ""}.</div>`
          : e.tries ? `<div class="err-hint">Tried again ${e.tries} time${e.tries === 1 ? "" : "s"}.</div>` : "") + `</li>`;
    }).join("");
    $("errLogSummary").textContent = open ? `${open} part${open === 1 ? " is" : "s are"} still failing. Try again fetches only those parts.` : "Nothing is failing now.";
  }

  function setOpen(open) {
    const panel = $("errLogPanel"), btn = $("errLogToggle");
    if (!panel) return;
    panel.hidden = !open;
    btn.setAttribute("aria-expanded", String(open));
  }

  log.init = function () {
    const btn = $("errLogToggle");
    if (!btn) return;
    btn.addEventListener("click", () => setOpen($("errLogPanel").hidden));
    $("errLogClose").addEventListener("click", () => { setOpen(false); btn.focus(); });
    $("errLogClear").addEventListener("click", () => { log.clear(); setOpen(false); });
    $("errLogCopy").addEventListener("click", async () => {
      const b = $("errLogCopy");
      try { await root.navigator.clipboard.writeText(log.text()); b.textContent = "Copied"; }
      catch (e) { b.textContent = "Copy failed"; }
      setTimeout(() => { b.textContent = "Copy log"; }, 1500);
    });
    root.document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("errLogPanel").hidden) { setOpen(false); btn.focus(); } });
    render();
  };
  log.setOpen = setOpen;

  FRC.errorLog = log;
})(typeof window !== "undefined" ? window : globalThis);
