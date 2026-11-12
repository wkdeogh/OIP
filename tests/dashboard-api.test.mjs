import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { NextRequest } from "next/server.js";
import { createSessionToken } from "../lib/auth.ts";
import { DASHBOARD_RESOURCES } from "../lib/dashboard-sync.ts";

const dependencies = {
  "next/server": import.meta.resolve("next/server.js"),
  "@/lib/auth": new URL("../lib/auth.ts", import.meta.url).href,
  "@/lib/dashboard-sync": new URL("../lib/dashboard-sync.ts", import.meta.url).href,
  "@/lib/supabase-rest": new URL("../lib/supabase-rest.ts", import.meta.url).href,
};
const source = await readFile(new URL("../app/api/dashboard/route.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
  .replace(/from "([^"]+)"/g, (_match, specifier) => `from ${JSON.stringify(dependencies[specifier])}`);
const { GET } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

test("dashboard authenticates, rejects invalid users and preserves independent resource failures", async (context) => {
  const previous = Object.fromEntries(["OIP_PASSWORD", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"].map((key) => [key, process.env[key]]));
  Object.assign(process.env, { OIP_PASSWORD: "dashboard-test-only", SUPABASE_URL: "https://example.invalid", SUPABASE_SERVICE_ROLE_KEY: "test-only" });
  context.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  const calls = [];
  context.mock.method(globalThis, "fetch", async (input, init) => {
    const url = new URL(input);
    calls.push({ url, init });
    if (url.pathname.endsWith("/travel_wishlist")) return Response.json({ error: "unavailable" }, { status: 503 });
    if (url.pathname.endsWith("/trips")) throw new TypeError("network unavailable");
    return Response.json([{ id: url.pathname.split("/").at(-1) }]);
  });
  const unauthorized = await GET(new NextRequest("http://localhost/api/dashboard?user=daeho"));
  assert.equal(unauthorized.status, 401);
  assert.equal(calls.length, 0);
  const token = await createSessionToken();
  const request = (user) => new NextRequest(`http://localhost/api/dashboard?user=${user}`, { headers: { cookie: `oip_session=${token}` } });
  assert.equal((await GET(request("invalid"))).status, 400);
  assert.equal(calls.length, 0);
  const response = await GET(request("sanghee"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  const payload = await response.json();
  assert.deepEqual(payload.failedResources, ["trips", "travel_wishlist"]);
  assert.ok(payload.records.calendar_events);
  assert.ok(payload.records.parking_records);
  assert.equal(payload.records.travel_wishlist, undefined);
  assert.equal(calls.length, DASHBOARD_RESOURCES.length);
  for (const { url, init } of calls) {
    assert.equal(init.cache, "no-store");
    assert.ok(init.signal);
    if (url.pathname.endsWith("/todos") || url.pathname.endsWith("/calendar_events")) assert.equal(url.searchParams.get("or"), "(visibility.eq.shared,author_id.eq.sanghee)");
  }
});
