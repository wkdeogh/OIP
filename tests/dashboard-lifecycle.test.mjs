import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { setImmediate } from "node:timers/promises";
import test from "node:test";
import ts from "typescript";
import postcss from "postcss";
import { DASHBOARD_RESOURCES } from "../lib/dashboard-sync.ts";

const source = await readFile(new URL("../app/components/OipApp.tsx", import.meta.url), "utf8");
const parsed = ts.createSourceFile("OipApp.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let callback;
function visit(node) {
  if (ts.isCallExpression(node) && node.expression.getText(parsed) === "useEffect" && node.arguments[0]?.getText(parsed).includes("const resourcesByTab")) callback = node.arguments[0].getText(parsed);
  ts.forEachChild(node, visit);
}
visit(parsed);
assert.ok(callback, "Exercise the production live synchronization effect");
const compiled = ts.transpileModule(callback, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText.trim().replace(/;$/, "");

function harness() {
  const state = {};
  const timers = new Map();
  let timerId = 0;
  let implementation;
  const calls = [];
  const window = Object.assign(new EventTarget(), {
    setTimeout(fn, delay) { const id = ++timerId; timers.set(id, { fn, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
  });
  const document = Object.assign(new EventTarget(), { visibilityState: "visible" });
  const context = {
    window, document, AbortController, DASHBOARD_RESOURCES, LIVE_SYNC_INTERVAL_MS: 4000,
    authState: "ready", cacheReadyUser: null, currentUser: "daeho", isDataLoading: true, mainTab: "dashboard",
    pendingWritesRef: { current: 0 }, localMutationVersionRef: { current: 0 },
    authenticationRejectedRef: { current: false }, restoredCacheUserRef: { current: null },
    startTransition: (fn) => fn(), normalizeDayOff: (item) => item,
    retainEquivalentValue: (current, next) => JSON.stringify(current) === JSON.stringify(next) ? current : next,
    clearOipDataCache: async () => { state.cacheCleared = true; },
    fetch: async (url, init) => { calls.push({ url, init }); return implementation(url, init); },
  };
  for (const name of new Set(callback.match(/\bset[A-Z]\w*/g))) {
    context[name] = (value) => { state[name] = typeof value === "function" ? value(state[name] ?? []) : value; };
  }
  return {
    state, context, window, document, calls, timers,
    respond(fn) { implementation = fn; },
    start() { return new Function(...Object.keys(context), `return (${compiled})();`)(...Object.values(context)); },
    run(delay) {
      const entry = [...timers].find(([, timer]) => timer.delay === delay);
      assert.ok(entry, `Expected a ${delay}ms timer`);
      timers.delete(entry[0]);
      entry[1].fn();
    },
  };
}

const payload = (overrides = {}) => ({ records: { ...Object.fromEntries(DASHBOARD_RESOURCES.map((resource) => [resource, []])), ...overrides }, failedResources: [] });

test("dashboard polling updates all features, preserves failed data and recovers without a reload", async () => {
  const h = harness();
  let next = payload({ calendar_events: [{ id: "event", title: "기존 일정" }], parking_records: [{ id: "parking" }] });
  h.respond(async () => Response.json(next));
  const stop = h.start();
  await setImmediate();
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].url, "/api/dashboard?user=daeho");
  assert.equal(h.calls[0].init.cache, "no-store");
  assert.equal(h.state.setDashboardSyncState, "live");
  assert.equal(h.state.setIsDataLoading, false);
  assert.equal(h.state.setEvents[0].title, "기존 일정");
  assert.equal(h.state.setParking.id, "parking");

  next = payload({ fridge_items: [{ id: "new-food" }] });
  delete next.records.calendar_events;
  next.failedResources.push("calendar_events");
  h.run(4000);
  await setImmediate();
  assert.equal(h.state.setDashboardSyncState, "delayed");
  assert.equal(h.state.setEvents[0].title, "기존 일정");
  assert.equal(h.state.setFridge[0].id, "new-food");
  assert.equal(h.state.setParking, null);

  h.respond(async () => { throw new TypeError("offline"); });
  h.run(4000);
  await setImmediate();
  assert.equal(h.state.setEvents[0].title, "기존 일정");
  h.respond(async () => Response.json(payload()));
  h.window.dispatchEvent(new Event("online"));
  await setImmediate();
  assert.equal(h.state.setDashboardSyncState, "live");
  assert.deepEqual(h.state.setEvents, []);
  stop();
  assert.equal(h.timers.size, 0);
});

test("hidden screens pause polling and visible/pageshow events resume it", async () => {
  const h = harness();
  h.respond(async () => Response.json(payload()));
  const stop = h.start();
  await setImmediate();
  h.document.visibilityState = "hidden";
  h.document.dispatchEvent(new Event("visibilitychange"));
  assert.equal(h.timers.size, 0);
  assert.equal(h.calls.length, 1);
  h.document.visibilityState = "visible";
  h.document.dispatchEvent(new Event("visibilitychange"));
  await setImmediate();
  assert.equal(h.calls.length, 2);
  h.window.dispatchEvent(new Event("pageshow"));
  await setImmediate();
  assert.equal(h.calls.length, 3);
  stop();
  h.window.dispatchEvent(new Event("pageshow"));
  assert.equal(h.calls.length, 3);
});

test("stalled requests time out and expired sessions return to authentication", async () => {
  const h = harness();
  h.respond((_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true })));
  const stop = h.start();
  h.run(15000);
  await setImmediate();
  assert.equal(h.state.setDashboardSyncState, "delayed");
  h.respond(async () => new Response(null, { status: 401 }));
  h.run(4000);
  await setImmediate();
  assert.equal(h.context.authenticationRejectedRef.current, true);
  assert.equal(h.state.cacheCleared, true);
  assert.equal(h.state.setAuthState, "locked");
  stop();
  assert.equal(h.timers.size, 0);
});

const viewSource = await readFile(new URL("../app/components/DashboardView.tsx", import.meta.url), "utf8");
const viewParsed = ts.createSourceFile("DashboardView.tsx", viewSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const viewEffects = [];
function collectEffects(node) {
  if (ts.isCallExpression(node) && node.expression.getText(viewParsed) === "useEffect") viewEffects.push(node.arguments[0].getText(viewParsed));
  ts.forEachChild(node, collectEffects);
}
collectEffects(viewParsed);
function runViewEffect(contains, context) {
  const effect = viewEffects.find((code) => code.includes(contains));
  assert.ok(effect);
  const compiled = ts.transpileModule(effect, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText.trim().replace(/;$/, "");
  return new Function(...Object.keys(context), `return (${compiled})();`)(...Object.values(context));
}

test("screen wake lock is reacquired after suspension, released on exit and handles unsupported devices", async () => {
  const window = new EventTarget();
  const document = Object.assign(new EventTarget(), { visibilityState: "visible" });
  const locks = [];
  let state;
  const navigator = { wakeLock: { async request(type) {
    assert.equal(type, "screen");
    const lock = Object.assign(new EventTarget(), { released: false, async release() { this.released = true; this.dispatchEvent(new Event("release")); } });
    locks.push(lock);
    return lock;
  } } };
  const context = { window, document, navigator, setWakeState: (value) => { state = value; } };
  const stop = runViewEffect('if (!("wakeLock" in navigator))', context);
  await setImmediate();
  assert.equal(state, "active");
  document.visibilityState = "hidden";
  await locks[0].release();
  document.dispatchEvent(new Event("visibilitychange"));
  assert.equal(state, "released");
  assert.equal(locks.length, 1);
  document.visibilityState = "visible";
  document.dispatchEvent(new Event("visibilitychange"));
  await setImmediate();
  assert.equal(locks.length, 2);
  assert.equal(state, "active");
  stop();
  assert.equal(locks[1].released, true);
  navigator.wakeLock.request = async () => { throw new Error("low power"); };
  const stopDenied = runViewEffect('if (!("wakeLock" in navigator))', context);
  await setImmediate();
  assert.equal(state, "released");
  stopDenied();
  assert.equal(runViewEffect('if (!("wakeLock" in navigator))', { ...context, navigator: {} }), undefined);
});

test("the running display clock crosses Seoul midnight and refreshes immediately after wake", (context) => {
  context.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-12-31T14:59:59Z") });
  let tick;
  let current;
  const window = Object.assign(new EventTarget(), { setInterval(fn, interval) { assert.equal(interval, 1000); tick = fn; return 1; }, clearInterval() { tick = null; } });
  const document = new EventTarget();
  const stop = runViewEffect("window.setInterval", { window, document, navigator: { onLine: true }, setNow: (value) => { current = value; }, setOnline() {} });
  context.mock.timers.tick(1000);
  tick();
  assert.equal(current.toISOString(), "2026-12-31T15:00:00.000Z");
  context.mock.timers.tick(60_000);
  window.dispatchEvent(new Event("pageshow"));
  assert.equal(current.toISOString(), "2026-12-31T15:01:00.000Z");
  stop();
  assert.equal(tick, null);
});

test("responsive CSS hides phone entry and assigns all five areas on iPad and desktop", async () => {
  const css = postcss.parse(await readFile(new URL("../app/dashboard.css", import.meta.url), "utf8"));
  function matches(media, width, height) {
    return media.split(" and ").every((condition) => {
      const size = /\((min|max)-(width|height):\s*(\d+)px\)/.exec(condition);
      if (size) {
        const value = size[2] === "width" ? width : height;
        return size[1] === "min" ? value >= Number(size[3]) : value <= Number(size[3]);
      }
      const ratio = /\(min-aspect-ratio:\s*(\d+)\/(\d+)\)/.exec(condition);
      return ratio ? width / height >= Number(ratio[1]) / Number(ratio[2]) : false;
    });
  }
  function value(selector, property, width, height) {
    let result;
    css.walkRules(selector, (rule) => {
      if (rule.parent.type === "atrule" && !matches(rule.parent.params, width, height)) return;
      rule.walkDecls(property, (declaration) => { result = declaration.value; });
    });
    return result;
  }
  for (const [width, height] of [[320, 568], [390, 844], [932, 430]]) assert.equal(value(".dashboard-entry", "display", width, height), "none");
  for (const [width, height] of [[768, 1024], [1024, 768], [1366, 768], [1920, 1080]]) {
    assert.equal(value(".dashboard-entry", "display", width, height), "inline-flex");
    const areas = value(".dashboard-grid", "grid-template-areas", width, height);
    for (const area of ["schedule", "tasks", "travel", "fridge", "parking"]) assert.ok(areas.includes(area));
    const rows = areas.match(/"[^"]+"/g);
    assert.equal(rows.length, width < 1024 ? 3 : 2);
    assert.equal(value(".dashboard", "height", width, height), "100dvh");
  }
});
