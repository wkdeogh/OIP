import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { calendarDateKey, calendarEventsInRange, sourceEventId } from "../lib/calendar-recurrence.ts";

// Render the real calendar hierarchy with stored source records, rather than
// testing expansion in isolation. Only unrelated screens are replaced.
const source = await readFile(new URL("../app/components/OipApp.tsx", import.meta.url), "utf8");
const replacements = {
  react: import.meta.resolve("react"),
  "react/jsx-runtime": import.meta.resolve("react/jsx-runtime"),
  "react-dom": import.meta.resolve("react-dom"),
  "@/lib/calendar-reminders": new URL("../lib/calendar-reminders.ts", import.meta.url).href,
  "@/lib/calendar-recurrence": new URL("../lib/calendar-recurrence.ts", import.meta.url).href,
  "@/lib/client-data-cache": new URL("../lib/client-data-cache.ts", import.meta.url).href,
  "../../lib/travel-place-name": new URL("../lib/travel-place-name.ts", import.meta.url).href,
  "./TravelMap": "data:text/javascript,export function TravelMap(){return null}",
  "./EventRecurrenceFields": "data:text/javascript,export function EventRecurrenceFields(){return null}",
};
const compiled = ts.transpileModule(`${source}\nexport { CalendarView };`, {
  compilerOptions: { module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
}).outputText.replace(/from "([^"]+)"/g, (_match, specifier) => {
  assert.ok(replacements[specifier], `Declare calendar test dependency: ${specifier}`);
  return `from ${JSON.stringify(replacements[specifier])}`;
});
const { CalendarView } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

function event(start, rule, overrides = {}) {
  return {
    id: "display-series", title: "매월 점검 테스트",
    start_at: `${start}T12:00:00+09:00`, end_at: null,
    is_all_day: true, visibility: "shared", author_id: "daeho",
    event_type: "normal", recurrence_rule: rule, ...overrides,
  };
}

function calendar(events, selectedDate) {
  return renderToStaticMarkup(createElement(CalendarView, {
    events, selectedDate, backgrounds: [], daysOff: [], holidays: [],
    colorDefaults: { daeho: "#7FA99B", sanghee: "#E9A6AD", shared: "#EBC44F", private: "#B596DE" },
    ...Object.fromEntries([
      "setSelectedDate", "onAddEvent", "onAddDayOff", "onDeleteEvent", "onDeleteDayOff",
      "onVisibleYearChange", "onEditEvent", "onSetBackground",
    ].map((name) => [name, () => {}])),
  }));
}

function dateCells(html, date) {
  return [...html.matchAll(new RegExp(`<button\\b(?=[^>]*data-calendar-date="${date}")[^>]*>[\\s\\S]*?</button>`, "g"))].map((match) => match[0]);
}

function assertEvent(html, date, title, expected = true) {
  const cells = dateCells(html, date);
  assert.ok(cells.length > 0, `Calendar must render a cell for ${date}`);
  for (const cell of cells) {
    assert.equal(cell.includes(title), expected, `${date}: ${expected ? "missing" : "unexpected"} event ${title}`);
    if (expected) assert.match(cell, /일정 1개/);
  }
}

test("October 26 monthly event appears in the prefetched November 26 calendar cell", () => {
  const source = event("2026-10-26", "FREQ=MONTHLY");
  const html = calendar([source], "2026-10-26");
  assertEvent(html, "2026-10-26", source.title);
  assertEvent(html, "2026-11-26", source.title);
});

test("raw stored series renders in November, December and a directly opened future month", () => {
  const source = event("2026-10-26", "FREQ=MONTHLY");
  for (const date of ["2026-11-26", "2026-12-26", "2027-04-26"]) {
    assertEvent(calendar([source], date), date, source.title);
  }
});

test("yearly stored event renders on the same date next year", () => {
  const source = event("2026-10-26", "FREQ=YEARLY");
  assertEvent(calendar([source], "2027-10-26"), "2027-10-26", source.title);
  assertEvent(calendar([source], "2026-11-26"), "2026-11-26", source.title, false);
});

test("month-end correction is visible in actual calendar cells", () => {
  const source = event("2026-01-31", "FREQ=MONTHLY");
  assertEvent(calendar([source], "2026-02-28"), "2026-02-28", source.title);
  assertEvent(calendar([source], "2026-03-31"), "2026-03-31", source.title);
});

test("calendar stops rendering repeats after the inclusive end date", () => {
  const source = event("2026-10-26", "FREQ=MONTHLY;UNTIL=20261126");
  assertEvent(calendar([source], "2026-11-26"), "2026-11-26", source.title);
  assertEvent(calendar([source], "2026-12-26"), "2026-12-26", source.title, false);
});

test("non-recurring events stay on their original date", () => {
  const source = event("2026-10-26", null);
  const html = calendar([source], "2026-10-26");
  assertEvent(html, "2026-10-26", source.title);
  assertEvent(html, "2026-11-26", source.title, false);
});

test("grid range and day detail produce identical repeated event identities", () => {
  const source = event("2026-10-26", "FREQ=MONTHLY");
  const monthEvents = calendarEventsInRange([source], "2026-11-01", "2026-11-30");
  const dayEvents = calendarEventsInRange([source], "2026-11-26", "2026-11-26");
  assert.deepEqual(dayEvents, monthEvents.filter((item) => calendarDateKey(item.start_at) === "2026-11-26"));
  assert.equal(dayEvents.length, 1);
  assert.equal(sourceEventId(dayEvents[0]), source.id);
});

test("system events do not duplicate matching recurring events in grid or day detail", () => {
  const source = event("2026-10-26", "FREQ=MONTHLY");
  const system = event("2026-11-26", null, { id: "system-fixture", author_id: "system" });
  for (const [from, to] of [["2026-11-01", "2026-11-30"], ["2026-11-26", "2026-11-26"]]) {
    assert.equal(calendarEventsInRange([source], from, to, [system]).length, 1);
  }
});

test("yearly leap-day events render on February 28 and return to February 29", () => {
  const source = event("2024-02-29", "FREQ=YEARLY");
  assertEvent(calendar([source], "2027-02-28"), "2027-02-28", source.title);
  assertEvent(calendar([source], "2028-02-29"), "2028-02-29", source.title);
});

test("repeated multi-day bars cover all dates of the next occurrence", () => {
  const source = event("2026-10-26", "FREQ=MONTHLY", { end_at: "2026-10-28T23:59:59+09:00" });
  const html = calendar([source], "2026-11-26");
  assertEvent(html, "2026-11-26", source.title);
  for (const date of ["2026-11-27", "2026-11-28"]) {
    const cells = dateCells(html, date);
    assert.ok(cells.length > 0);
    for (const cell of cells) {
      assert.match(cell, /일정 1개/);
      assert.match(cell, /event-chip--range/);
    }
  }
});
