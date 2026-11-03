// Tests for the shared fetch helper: automatic retries, the request limit,
// and remembered results. Run from this folder: npm test
const assert = require("assert");
globalThis.FRC = {};
let calls = [], running = 0, maxRunning = 0, plan = {};
globalThis.fetch = async (url) => {
  calls.push(url); running++; maxRunning = Math.max(maxRunning, running);
  await new Promise((r) => setTimeout(r, 30));
  running--;
  const next = (plan[url] || []).shift();
  if (next === "net") throw new TypeError("Failed to fetch");
  if (typeof next === "number") return { ok: false, status: next, json: async () => ({}) };
  if (next === "errbody") return { ok: true, status: 200, json: async () => ({ error: { message: "Failed to execute query." } }) };
  return { ok: true, status: 200, json: async () => ({ url }) };
};
require("../js/util.js");
const U = globalThis.FRC.util;

let passed = 0;
const test = async (name, fn) => { calls = []; plan = {}; U.cache.clear(); await fn(); passed++; console.log("  ok  " + name); };

(async () => {
  console.log("Fetch helper tests");
  await test("A dropped request is tried again by itself and then works", async () => {
    plan["https://a/1"] = ["net", 503];
    const d = await U.getJSON("https://a/1");
    assert.strictEqual(d.url, "https://a/1");
    assert.strictEqual(calls.length, 3);
  });
  await test("A refusal (404) is not retried, and the error carries the request address", async () => {
    plan["https://a/2"] = [404];
    await assert.rejects(U.getJSON("https://a/2"), (e) => e.message === "HTTP 404" && e.url === "https://a/2" && e.attempts === 1);
    assert.strictEqual(calls.length, 1);
  });
  await test("After three failures the error says how many tries were made", async () => {
    plan["https://a/3"] = [500, 500, 500];
    await assert.rejects(U.getJSON("https://a/3"), (e) => /tried 3 times/.test(e.message) && e.url === "https://a/3");
  });
  await test("Map data is remembered; Check (fresh) asks again; live data is never remembered", async () => {
    await U.getJSON("https://a/4"); await U.getJSON("https://a/4");
    assert.strictEqual(calls.length, 1);
    await U.fresh(() => U.getJSON("https://a/4"));
    assert.strictEqual(calls.length, 2);
    await U.getJSON("https://x/flood-monitoring/id/floods"); await U.getJSON("https://x/flood-monitoring/id/floods");
    assert.strictEqual(calls.length, 4);
  });
  await test("An ArcGIS error answer (HTTP 200 with an error body) is never remembered", async () => {
    plan["https://a/5"] = ["errbody"];
    const first = await U.getJSON("https://a/5");
    assert.ok(first.error);
    const second = await U.getJSON("https://a/5");
    assert.ok(!second.error);
    assert.strictEqual(calls.length, 2);
  });
  await test("At most 4 requests run at the same time", async () => {
    maxRunning = 0;
    await Promise.all(Array.from({ length: 12 }, (_, i) => U.getJSON("https://b/" + i)));
    assert.strictEqual(calls.length, 12);
    assert.ok(maxRunning <= 4, "ran " + maxRunning + " at once");
  });
  console.log(`\n${passed} tests passed`);
})().catch((e) => { console.error(e); process.exit(1); });
