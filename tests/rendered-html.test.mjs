import assert from "node:assert/strict";
import test from "node:test";

async function render(path = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${path}`, {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the OIP application shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<html[^>]+lang="ko"/i);
  assert.match(html, /<title>OIP<\/title>/i);
  assert.match(html, /oip_logo\.png/i);
  assert.match(html, /manifest\.webmanifest/i);
  assert.match(html, /oip\.theme/i);
  assert.match(html, /prefers-color-scheme:\s*dark/i);
  assert.match(html, /불러오는 중/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/i);
});

test("server-renders the direct parking route", async () => {
  const response = await render("/parking");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /불러오는 중/);
  assert.match(html, /parking/i);
});

test("protects push subscription and reminder endpoints", async () => {
  const subscription = await render("/api/push/subscription");
  assert.equal(subscription.status, 401);

  const reminders = await render("/api/cron/calendar-reminders");
  assert.equal(reminders.status, 401);
});
