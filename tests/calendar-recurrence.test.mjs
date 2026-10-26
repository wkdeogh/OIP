import assert from "node:assert/strict";
import test from "node:test";
import {
  calendarDateKey,
  expandCalendarEvents,
  isCalendarDate,
  parseRecurrenceRule,
  recurrenceLabel,
  recurrencePreview,
  recurrenceRule,
  sourceEventId,
} from "../lib/calendar-recurrence.ts";
import { pickAllowedFields, supabaseRest } from "../lib/supabase-rest.ts";
import { calendarReminderPayload, visibleReminderEvents } from "../lib/calendar-reminders.ts";

function event(start, rule = null, overrides = {}) {
  return {
    id: "series-1", title: "정기 일정", start_at: `${start}T09:30:00+09:00`,
    end_at: null, is_all_day: false, visibility: "private", author_id: "daeho",
    event_type: "normal", recurrence_rule: rule, ...overrides,
  };
}
const dates = (events) => events.map((item) => calendarDateKey(item.start_at));

test("monthly 31st clamps to February and restores the original day in March", () => {
  const source = event("2026-01-31", "FREQ=MONTHLY");
  const occurrences = expandCalendarEvents([source], "2026-01-01", "2026-05-31");
  assert.deepEqual(dates(occurrences), ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31"]);
  assert.equal(source.start_at, "2026-01-31T09:30:00+09:00");
  assert.equal(sourceEventId(occurrences[2]), source.id);
  assert.equal(new Set(occurrences.map((item) => item.id)).size, 5);
});

test("monthly 29th/30th anchors and leap February retain their original day", () => {
  for (const day of [29, 30]) {
    assert.deepEqual(dates(expandCalendarEvents([event(`2024-01-${day}`, "FREQ=MONTHLY")], "2024-02-01", "2024-03-31")), ["2024-02-29", `2024-03-${day}`]);
  }
});

test("yearly leap day clamps in common years and returns to February 29", () => {
  assert.deepEqual(dates(expandCalendarEvents([event("2024-02-29", "FREQ=YEARLY")], "2024-01-01", "2028-12-31")), ["2024-02-29", "2025-02-28", "2026-02-28", "2027-02-28", "2028-02-29"]);
});

test("repeats never occur before the first date, including dates in the same month", () => {
  const source = event("2026-10-26", "FREQ=MONTHLY");
  assert.deepEqual(expandCalendarEvents([source], "2025-01-01", "2026-10-25"), []);
  assert.deepEqual(dates(expandCalendarEvents([source], "2026-10-26", "2026-10-26")), ["2026-10-26"]);
});

test("UNTIL is inclusive for start dates and does not truncate multi-day occurrences", () => {
  const source = event("2026-01-31", "FREQ=MONTHLY;UNTIL=20260228", { end_at: "2026-02-02T10:30:00+09:00" });
  assert.deepEqual(dates(expandCalendarEvents([source], "2026-01-01", "2027-01-01")), ["2026-01-31", "2026-02-28"]);
  const overlapping = expandCalendarEvents([source], "2026-03-02", "2026-03-02");
  assert.equal(overlapping.length, 1);
  assert.equal(calendarDateKey(overlapping[0].end_at), "2026-03-02");
  assert.deepEqual(expandCalendarEvents([source], "2026-03-03", "2026-03-31"), []);
});

test("Seoul date and clock time survive UTC storage and a different host timezone", () => {
  const source = event("2026-01-01", "FREQ=MONTHLY", {
    start_at: "2025-12-31T15:30:00Z", end_at: "2025-12-31T17:00:00Z",
    memo: "공유하지 않는 메모", custom_color: "#7FC1EB",
  });
  const [occurrence] = expandCalendarEvents([source], "2026-02-01", "2026-02-01");
  assert.equal(occurrence.start_at, "2026-01-31T15:30:00.000Z");
  assert.equal(occurrence.end_at, "2026-01-31T17:00:00.000Z");
  assert.equal(occurrence.memo, source.memo);
  assert.equal(occurrence.custom_color, source.custom_color);
  assert.equal(occurrence.visibility, "private");
});

test("multi-day, all-day and year-crossing events appear when the first day is offscreen", () => {
  const source = event("2025-12-30", "FREQ=YEARLY", { end_at: "2026-01-03T23:59:59+09:00", is_all_day: true });
  const [occurrence] = expandCalendarEvents([source], "2027-01-02", "2027-01-02");
  assert.equal(calendarDateKey(occurrence.start_at), "2026-12-30");
  assert.equal(calendarDateKey(occurrence.end_at), "2027-01-03");
  assert.equal(occurrence.is_all_day, true);
});

test("overlapping occurrences of one long series have distinct ids", () => {
  const source = event("2026-01-01", "FREQ=MONTHLY", { end_at: "2026-02-10T12:00:00+09:00" });
  const occurrences = expandCalendarEvents([source], "2026-02-05", "2026-02-05");
  assert.deepEqual(dates(occurrences), ["2026-01-01", "2026-02-01"]);
  assert.notEqual(occurrences[0].id, occurrences[1].id);
  assert.equal(sourceEventId(occurrences[0]), sourceEventId(occurrences[1]));
});

test("non-recurring events retain their identity and obey range boundaries", () => {
  const source = event("2026-10-26");
  assert.equal(expandCalendarEvents([source], "2026-10-26", "2026-10-26")[0], source);
  assert.deepEqual(expandCalendarEvents([source], "2026-11-01", "2026-11-30"), []);
  assert.equal(sourceEventId(source), source.id);
});

test("invalid rules and dates are rejected and previews match actual expansion", () => {
  for (const rule of ["FREQ=DAILY", "FREQ=MONTHLY;UNTIL=20260230", "FREQ=YEARLY;COUNT=3", "garbage"]) assert.equal(parseRecurrenceRule(rule), null);
  assert.equal(isCalendarDate("2026-02-29"), false);
  assert.equal(isCalendarDate("2024-02-29"), true);
  assert.deepEqual(expandCalendarEvents([event("invalid", "FREQ=MONTHLY")], "2026-01-01", "2026-12-31"), []);
  const rule = recurrenceRule("MONTHLY", "2026-03-31");
  assert.equal(rule, "FREQ=MONTHLY;UNTIL=20260331");
  assert.deepEqual(recurrencePreview("2026-01-31", rule), ["2026-01-31", "2026-02-28", "2026-03-31"]);
  assert.equal(recurrenceLabel(rule, "2026-01-31"), "매월 31일");
  assert.equal(recurrenceLabel("FREQ=YEARLY", "2024-02-29"), "매년 2월 29일");
  assert.equal(recurrenceRule(null), null);
});

test("old series expand only the requested future range", () => {
  const occurrences = expandCalendarEvents([event("1900-01-31", "FREQ=MONTHLY")], "2099-01-01", "2099-03-31");
  assert.deepEqual(dates(occurrences), ["2099-01-31", "2099-02-28", "2099-03-31"]);
});

test("recurring daily reminders use occurrence time and preserve private visibility", () => {
  const occurrences = expandCalendarEvents([
    event("2025-01-26", "FREQ=MONTHLY"),
    event("2025-10-26", "FREQ=YEARLY", { id: "shared", title: "기념일", visibility: "shared", is_all_day: true }),
  ], "2026-10-26", "2026-10-26");
  const mine = visibleReminderEvents(occurrences, "daeho");
  const spouse = visibleReminderEvents(occurrences, "sanghee");
  assert.equal(mine.length, 2);
  assert.equal(spouse.length, 1);
  const payload = calendarReminderPayload(mine, "2026-10-26");
  assert.match(payload.body, /09:30 정기 일정/);
  assert.doesNotMatch(payload.body, /진행 중/);
  assert.equal(payload.url, "/?date=2026-10-26");
});

test("recurrence survives the existing REST save/read path and can be removed", async () => {
  const originalFetch = globalThis.fetch;
  const oldUrl = process.env.SUPABASE_URL;
  const oldKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = "https://example.invalid";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only";
  let stored;
  globalThis.fetch = async (_url, init) => {
    if (init?.method === "POST") stored = JSON.parse(init.body);
    if (init?.method === "PATCH") Object.assign(stored, JSON.parse(init.body));
    return Response.json([stored]);
  };
  try {
    const source = event("2026-01-31", "FREQ=MONTHLY");
    const payload = pickAllowedFields("calendar_events", { ...source, source_event_id: "must-not-save" });
    assert.equal(payload.source_event_id, undefined);
    await supabaseRest("calendar_events", new URLSearchParams(), { method: "POST", body: JSON.stringify(payload) });
    const rows = await (await supabaseRest("calendar_events", new URLSearchParams())).json();
    assert.deepEqual(dates(expandCalendarEvents(rows, "2026-02-01", "2026-02-28")), ["2026-02-28"]);
    await supabaseRest("calendar_events", new URLSearchParams({ id: "eq.series-1" }), { method: "PATCH", body: JSON.stringify(pickAllowedFields("calendar_events", { recurrence_rule: null })) });
    assert.deepEqual(expandCalendarEvents([stored], "2026-02-01", "2026-02-28"), []);
  } finally {
    globalThis.fetch = originalFetch;
    if (oldUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = oldKey;
  }
});
