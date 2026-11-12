import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { calendarDateKey } from "../lib/calendar-recurrence.ts";
import { recordReadFilters } from "../lib/supabase-rest.ts";

async function compile(path, dependencies) {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText.replace(/from "([^"]+)"/g, (_match, specifier) => {
    assert.ok(dependencies[specifier], `Declare dashboard test dependency: ${specifier}`);
    return `from ${JSON.stringify(dependencies[specifier])}`;
  });
  return `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`;
}

const dataUrl = await compile("../lib/dashboard-data.ts", {
  "./calendar-recurrence": new URL("../lib/calendar-recurrence.ts", import.meta.url).href,
  "./calendar-reminders": new URL("../lib/calendar-reminders.ts", import.meta.url).href,
});
const { buildDashboardData, dashboardDaysUntil } = await import(dataUrl);
const viewUrl = await compile("../app/components/DashboardView.tsx", {
  react: import.meta.resolve("react"),
  "react/jsx-runtime": import.meta.resolve("react/jsx-runtime"),
  "../../lib/calendar-recurrence": new URL("../lib/calendar-recurrence.ts", import.meta.url).href,
  "../../lib/dashboard-data": dataUrl,
});
const { DashboardView } = await import(viewUrl);

const base = {
  events: [], daysOff: [], holidays: [], todos: [], shopping: [], trips: [],
  travelWishlist: [], fridge: [], parking: null,
};
const event = (id, date, overrides = {}) => ({
  id, title: id, start_at: `${date}T09:00:00+09:00`, is_all_day: false,
  event_type: "normal", visibility: "shared", author_id: "daeho", ...overrides,
});

test("dashboard preserves recurrence, overlapping events, days off and private visibility", () => {
  const model = buildDashboardData({ ...base,
    events: [
      event("매월 일정", "2025-01-12", { recurrence_rule: "FREQ=MONTHLY" }),
      event("여러 날 일정", "2026-10-31", { end_at: "2026-11-13T18:00:00+09:00" }),
      event("상희 비공개", "2026-11-12", { visibility: "private", author_id: "sanghee" }),
      event("대호 비공개", "2026-11-12", { visibility: "private" }),
    ],
    daysOff: [{ id: "off", date: "2026-11-12", owner_id: "sanghee", day_off_type: "반차", half_day_period: "am" }],
    holidays: [{ date: "2026-11-12", name: "공휴일 테스트", is_holiday: true }],
  }, "2026-11-12", "daeho");
  const today = model.agenda[0];
  assert.deepEqual(today.events.map((item) => item.title).sort(), ["대호 비공개", "매월 일정", "여러 날 일정"]);
  assert.equal(today.daysOff[0].half_day_period, "am");
  assert.equal(today.holidays[0].name, "공휴일 테스트");
  assert.equal(model.monthDays.length, 42);
  assert.equal(model.monthDays[0].key, "2026-11-01");
  assert.equal(model.agenda.find((day) => day.key === "2026-11-17").events.some((item) => item.title === "만난 날 기념일"), true);
});

const fixture = {
  ...base,
  todos: [
    { id: "late", title: "기한 지난 할 일", due_at: "2026-11-11T00:00:00+09:00", is_completed: false, visibility: "shared", author_id: "daeho" },
    { id: "today", title: "오늘 할 일", due_at: "2026-11-12T00:00:00+09:00", is_completed: false, visibility: "shared", author_id: "daeho" },
    { id: "done", title: "끝난 할 일", is_completed: true, visibility: "shared", author_id: "daeho" },
    { id: "private", title: "상희 비공개 할 일", is_completed: false, visibility: "private", author_id: "sanghee" },
  ],
  shopping: [{ id: "buy", name: "우유", quantity: 2, unit: "개", is_purchased: false }, { id: "bought", name: "구매 완료 품목", is_purchased: true }],
  trips: [{ id: "trip", title: "제주 여행", destination: "제주도", start_date: "2026-11-13", end_date: "2026-11-15" }],
  travelWishlist: [{ id: "wish", name: "아이슬란드", is_completed: false }, { id: "visited", name: "완료 여행지", is_completed: true }],
  fridge: [
    { id: "fresh", name: "두부", expiration_date: "2026-11-12", quantity: 1, storage_type: "냉장" },
    { id: "consumed", name: "먹은 식품", expiration_date: "2026-11-10", consumed_at: "2026-11-11T00:00:00+09:00" },
  ],
  parking: { id: "park", floor: "B5", pillar_letter: "C", pillar_number: 2, author_id: "daeho", created_at: "2026-11-12T09:00:00+09:00" },
};

function render(data = fixture, overrides = {}) {
  return renderToStaticMarkup(createElement(DashboardView, {
    data, currentUser: "daeho", syncState: "live", lastSyncedAt: Date.now(), isLoading: false,
    theme: "light", onToggleTheme() {}, onOpen() {}, onChangeUser() {}, onYearChange() {}, ...overrides,
  }));
}

test("all five real panels render with unfinished items and the current parking location", (context) => {
  context.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-11-12T03:00:00Z") });
  const html = render();
  assert.equal((html.match(/<section /g) ?? []).length, 5);
  for (const text of ["일정", "할 일 · 쇼핑", "여행", "냉장고", "주차장", "기한 지난 할 일", "우유", "제주 여행", "아이슬란드", "두부", "B5", "C2", "오늘까지"]) assert.ok(html.includes(text), text);
  for (const text of ["끝난 할 일", "상희 비공개 할 일", "구매 완료 품목", "완료 여행지", "먹은 식품"]) assert.ok(!html.includes(text), text);
  assert.match(html, /자동 갱신 중/);
  assert.match(html, /자동 잠금은 기기 설정에서 해제/);
});

test("Seoul midnight changes today, the travel countdown, overdue tasks and expiry without new data", (context) => {
  context.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-11-12T14:59:59Z") });
  const before = render();
  assert.match(before, /D-1/);
  assert.match(before, /오늘까지/);
  context.mock.timers.tick(1000);
  const after = render();
  assert.match(after, /여행 중/);
  assert.match(after, /1일 지남/);
  assert.match(after, /기한 지난 할 일 2개/);
  assert.match(after, /dateTime="2026-11-13"/i);
  assert.equal(dashboardDaysUntil("2026-11-13T00:00:00+09:00", "2026-11-13"), 0);
  const ended = buildDashboardData(fixture, "2026-11-16", "daeho");
  assert.equal(ended.trips.length, 0);
});

test("the month and year roll over and missing monthly dates remain clamped", () => {
  const model = buildDashboardData({ ...base, events: [event("월말", "2026-01-31", { recurrence_rule: "FREQ=MONTHLY" })] }, "2027-02-28", "daeho");
  assert.equal(model.year, 2027);
  assert.equal(model.month, 2);
  assert.equal(calendarDateKey(model.agenda[0].events[0].start_at), "2027-02-28");
  assert.equal(buildDashboardData(base, "2027-01-01", "daeho").month, 1);
});

test("custom parking locations and delayed synchronization are visible", () => {
  const html = render({ ...fixture, parking: { ...fixture.parking, custom_location: "지하 2층 전기차 충전구역" } }, { syncState: "delayed" });
  assert.match(html, /지하 2층 전기차 충전구역/);
  assert.doesNotMatch(html, />B5</);
  assert.match(html, /갱신 지연 · 재시도 중/);
});

test("dashboard uses the same server-side visibility and consumption filters as the app", () => {
  const query = new URLSearchParams();
  for (const resource of ["calendar_events", "todos"]) {
    assert.equal(recordReadFilters(resource, query, "sanghee").get("or"), "(visibility.eq.shared,author_id.eq.sanghee)");
    assert.throws(() => recordReadFilters(resource, query, "unknown"), /INVALID_USER/);
  }
  assert.equal(recordReadFilters("fridge_items", query, "daeho").get("consumed_at"), "is.null");
  const parking = recordReadFilters("parking_records", query, "daeho");
  assert.equal(parking.get("limit"), "1");
  assert.equal(parking.get("order"), "created_at.desc");
});
