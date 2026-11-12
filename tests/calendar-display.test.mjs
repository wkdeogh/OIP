import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { calendarDateKey, calendarEventsInRange, parseRecurrenceRule, sourceEventId } from "../lib/calendar-recurrence.ts";

// Render the real calendar hierarchy with stored source records, rather than
// testing expansion in isolation. Only unrelated screens are replaced.
const source = await readFile(new URL("../app/components/OipApp.tsx", import.meta.url), "utf8");
const replacements = {
  react: import.meta.resolve("react"),
  "react/jsx-runtime": import.meta.resolve("react/jsx-runtime"),
  "react-dom": import.meta.resolve("react-dom"),
  "@/lib/calendar-reminders": new URL("../lib/calendar-reminders.ts", import.meta.url).href,
  "@/lib/calendar-event-segment": new URL("../lib/calendar-event-segment.ts", import.meta.url).href,
  "@/lib/calendar-recurrence": new URL("../lib/calendar-recurrence.ts", import.meta.url).href,
  "@/lib/client-data-cache": new URL("../lib/client-data-cache.ts", import.meta.url).href,
  "../../lib/travel-place-name": new URL("../lib/travel-place-name.ts", import.meta.url).href,
  "./TravelMap": "data:text/javascript,export function TravelMap(){return null}",
  "./DashboardView": "data:text/javascript,export function DashboardView(){return null}",
  "@/lib/dashboard-sync": new URL("../lib/dashboard-sync.ts", import.meta.url).href,
  "./EventRecurrenceFields": "data:text/javascript,export function EventRecurrenceFields(){return null}",
};
const compiled = ts.transpileModule(`${source}\nexport { CalendarView, CalendarDaySheet, EventForm, EventMemoEditor, optionalFormValue };`, {
  compilerOptions: { module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
}).outputText.replace(/from "([^"]+)"/g, (_match, specifier) => {
  assert.ok(replacements[specifier], `Declare calendar test dependency: ${specifier}`);
  return `from ${JSON.stringify(replacements[specifier])}`;
});
const { CalendarView, CalendarDaySheet, EventForm, EventMemoEditor, optionalFormValue } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

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
      "onVisibleYearChange", "onEditEvent", "onSetBackground", "onSaveEventMemo",
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

test("multi-day bars span the month boundary continuously in both adjacent calendars", () => {
  for (const rule of [null, "FREQ=YEARLY"]) {
    const source = event("2027-02-24", rule, {
      end_at: "2027-03-03T23:59:59+09:00",
    });
    for (const selectedDate of ["2027-02-24", "2027-03-01"]) {
      const html = calendar([source], selectedDate);
      const firstDayCells = dateCells(html, "2027-03-01");
      assert.ok(firstDayCells.length > 0);
      for (const cell of firstDayCells) {
        assert.match(cell, /일정 1개/);
        assert.match(cell, /event-chip--range/);
        assert.doesNotMatch(cell, /event-chip--segment-start|event-chip--segment-end/);
        assert.doesNotMatch(cell, /data-span-end/);
      }
      for (const date of ["2027-03-02", "2027-03-03"]) {
        const cells = dateCells(html, date);
        assert.ok(cells.length > 0);
        for (const cell of cells) {
          assert.match(cell, /일정 1개/);
          assert.match(cell, /event-chip--range/);
        }
      }
      const segmentStartCells = dateCells(html, "2027-02-28");
      assert.ok(segmentStartCells.length > 0);
      for (const cell of segmentStartCells) {
        assert.match(cell, /event-chip--segment-start/);
        assert.doesNotMatch(cell, /event-chip--segment-end/);
        assert.match(cell, /background-color:#EBC44F/);
        assert.match(cell, /data-span-end="2027-03-03"/);
        assert.ok(cell.includes(source.title));
      }
      for (const cell of dateCells(html, "2027-03-04")) {
        assert.doesNotMatch(cell, /event-chip--range/);
      }
    }
  }
});

test("event form keeps memo text in the saved fields and places its button left of color", () => {
  for (const memo of ["", "준비물 확인\n주소: 서울 강남구", "<script>alert(1)</script>"]) {
    const html = renderToStaticMarkup(createElement(EventForm, {
      initialEvent: event("2027-02-24", null, { memo }),
      initialRange: { start: "2027-02-24", end: "2027-02-24" },
      currentUser: "daeho", scope: "shared",
      colorDefaults: { daeho: "#7FA99B", sanghee: "#E9A6AD", shared: "#EBC44F", private: "#B596DE" },
      onSaveDefaultColors: async () => true, onSubmit() {},
    }));
    assert.match(html, /<input(?=[^>]*name="memo")(?=[^>]*type="hidden")[^>]*value=/);
    assert.ok(html.indexOf('class="event-memo-trigger') < html.indexOf('class="event-color-trigger'));
    assert.ok(html.includes(memo ? "메모 수정" : "메모 작성"));
    assert.doesNotMatch(html, /<script>/);
    if (memo.includes("준비물")) assert.ok(html.includes("준비물 확인\n주소: 서울 강남구"));
  }
});

test("day list always offers memo editing before the schedule edit button", () => {
  const items = [
    event("2027-02-24", null, { id: "with-memo", title: "메모 일정", memo: "저장된 내용" }),
    event("2027-02-24", null, { id: "without-memo", title: "빈 일정", memo: null }),
  ];
  const html = renderToStaticMarkup(createElement(CalendarDaySheet, {
    date: "2027-02-24", events: items, daysOff: [], holidays: [],
    colorDefaults: { daeho: "#7FA99B", sanghee: "#E9A6AD", shared: "#EBC44F", private: "#B596DE" },
    ...Object.fromEntries(["onAddDayOff", "onAddEvent", "onClose", "onDeleteDayOff", "onDeleteEvent", "onEditEvent", "onSaveEventMemo", "onSetBackground"].map(name => [name, () => {}])),
  }));
  for (const item of items) {
    const memoButton = html.indexOf(`aria-label="${item.title} 메모`);
    assert.ok(memoButton >= 0);
    assert.ok(memoButton < html.indexOf(`aria-label="${item.title} 일정 수정"`));
  }
});

test("memo editor opens with editable multiline text and permits clearing it", () => {
  for (const initialMemo of ["", "첫 번째 줄\n두 번째 줄", "<script>문자 그대로</script>"]) {
    const html = renderToStaticMarkup(createElement(EventMemoEditor, {
      initialMemo, eventTitle: "일정 제목", onClose() {}, onSave: async () => true,
    }));
    assert.match(html, /role="dialog"/);
    assert.match(html, /<textarea[^>]*name="event_memo"/);
    assert.doesNotMatch(html, /<textarea[^>]*required/);
    assert.match(html, /메모 저장/);
    assert.doesNotMatch(html, /<script>/);
    if (initialMemo.includes("첫 번째")) assert.ok(html.includes(initialMemo));
  }
});

test("memo marker appears only on schedules with content, at each visible bar end", () => {
  const source = event("2027-02-24", null, {
    memo: "준비물", end_at: "2027-03-03T23:59:59+09:00",
  });
  const html = calendar([source], "2027-03-01");
  for (const date of ["2027-02-24", "2027-02-28"]) {
    for (const cell of dateCells(html, date)) {
      assert.equal((cell.match(/class="event-chip-memo"/g) ?? []).length, 1);
      assert.match(cell, /event-chip--has-memo/);
      assert.doesNotMatch(cell, /준비물/);
    }
  }
  for (const date of ["2027-03-01", "2027-03-02", "2027-03-03"]) {
    for (const cell of dateCells(html, date)) assert.doesNotMatch(cell, /event-chip-memo/);
  }
  for (const memo of [null, "", " \n "]) {
    assert.doesNotMatch(calendar([{ ...source, memo }], "2027-03-01"), /event-chip-memo/);
  }
  const recurring = event("2026-10-26", "FREQ=MONTHLY", { memo: "반복 메모" });
  for (const cell of dateCells(calendar([recurring], "2026-11-26"), "2026-11-26")) {
    assert.match(cell, /event-chip-memo/);
  }
});

// Run the actual save callback with a controlled storage result and local state.
const parsed = ts.createSourceFile("OipApp.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function functionCode(name) {
  let found;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node;
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  assert.ok(found, `Expected production callback ${name}`);
  return ts.transpileModule(found.getText(parsed), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
}
const memoSaveCode = functionCode("saveEventMemo");

test("schedule creation and editing include memo content in the stored payload", async () => {
  const existing = event("2027-02-24", null, { memo: "원래 메모" });
  for (const [previous, memo] of [[null, "새 일정 메모"], [existing, "수정 메모"], [existing, ""]]) {
    const form = new FormData();
    for (const [name, value] of Object.entries({
      title: "일정", start_date: "2027-02-24", end_date: "2027-02-24", memo,
    })) form.set(name, value);
    let items = previous ? [previous] : [];
    const writes = [];
    const context = {
      editingEvent: previous, eventScope: "shared", currentUser: "daeho",
      FormData: function () { return form; }, optionalFormValue, parseRecurrenceRule,
      newId: () => "new-schedule", setEvents: update => { items = update(items); },
      setSelectedDate() {}, setModal() {}, setEditingEvent() {},
      showToast: message => assert.fail(message),
      writeRecord: async (...args) => { writes.push(args); return true; },
    };
    const save = new Function(...Object.keys(context), `${functionCode("saveEvent")}; return saveEvent;`)(...Object.values(context));
    save({ preventDefault() {}, currentTarget: null });
    await Promise.resolve();
    assert.equal(writes.length, 1);
    assert.equal(writes[0][0], previous ? "PATCH" : "POST");
    assert.equal(writes[0][2].memo, memo || null);
    assert.equal(items[0].memo, memo || null);
  }
});

test("memo-only save updates the source series while preserving dates, color and other fields", async () => {
  const stored = event("2026-10-26", "FREQ=MONTHLY", { memo: "기존 메모", custom_color: "#7FA99B" });
  const occurrence = calendarEventsInRange([stored], "2026-11-26", "2026-11-26")[0];
  let items = [stored];
  const writes = [];
  const save = new Function("events", "sourceEventId", "writeRecord", "setEvents", `${memoSaveCode}; return saveEventMemo;`)(
    items, sourceEventId,
    async (...args) => { writes.push(args); return true; },
    update => { items = update(items); },
  );
  assert.equal(await save(occurrence, " 새 메모\n다음 줄 "), true);
  assert.deepEqual(writes[0], ["PATCH", "calendar_events", { memo: "새 메모\n다음 줄" }, stored.id, true]);
  assert.deepEqual(items[0], { ...stored, memo: "새 메모\n다음 줄" });
  assert.equal(await save(occurrence, " \n "), true);
  assert.equal(items[0].memo, null);
});

test("failed memo save keeps the stored schedule unchanged and reports failure", async () => {
  const stored = event("2026-10-26", null, { memo: "기존 메모" });
  const save = new Function("events", "sourceEventId", "writeRecord", "setEvents", `${memoSaveCode}; return saveEventMemo;`)(
    [stored], sourceEventId, async () => false,
    () => assert.fail("A failed save must not change the schedule"),
  );
  assert.equal(await save(stored, "수정한 내용"), false);
  assert.equal(stored.memo, "기존 메모");
});
