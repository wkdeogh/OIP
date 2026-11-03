import assert from "node:assert/strict";
import test from "node:test";
import { calendarEventSegment } from "../lib/calendar-event-segment.ts";

function segments(start, end) {
  const result = [];
  const cursor = new Date(`${start}T12:00:00Z`);
  while (cursor.toISOString().slice(0, 10) <= end) {
    const dateKey = cursor.toISOString().slice(0, 10);
    const segment = calendarEventSegment({ start, end }, dateKey);
    if (segment.isSegmentStart) result.push([dateKey, segment.spanDays]);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return result;
}

test("continues February 24–March 3 without a break at the month boundary", () => {
  assert.deepEqual(segments("2027-02-24", "2027-03-03"), [
    ["2027-02-24", 4],
    ["2027-02-28", 4],
  ]);
  assert.equal(
    calendarEventSegment(
      { start: "2027-02-24", end: "2027-03-03" },
      "2027-03-03",
    ).isSegmentEnd,
    true,
  );
});

test("keeps a single segment across a month boundary within the same week", () => {
  const range = { start: "2026-03-30", end: "2026-04-03" };
  assert.deepEqual(segments(range.start, range.end), [
    ["2026-03-30", 5],
  ]);
  assert.equal(calendarEventSegment(range, "2026-03-31").isSegmentEnd, false);
  assert.equal(calendarEventSegment(range, "2026-04-01").isSegmentStart, false);
});

test("handles leap-day and year boundaries", () => {
  assert.deepEqual(segments("2028-02-24", "2028-03-03"), [
    ["2028-02-24", 3],
    ["2028-02-27", 6],
  ]);
  assert.deepEqual(segments("2026-12-30", "2027-01-03"), [
    ["2026-12-30", 4],
    ["2027-01-03", 1],
  ]);
});

test("preserves week breaks and single-day events", () => {
  assert.deepEqual(segments("2027-03-05", "2027-03-09"), [
    ["2027-03-05", 2],
    ["2027-03-07", 3],
  ]);
  assert.deepEqual(
    calendarEventSegment(
      { start: "2027-03-01", end: "2027-03-01" },
      "2027-03-01",
    ),
    { isRange: false, isSegmentStart: false, isSegmentEnd: false, spanDays: 1 },
  );
});

test("covers every event day once with breaks only between calendar weeks", () => {
  for (const [start, end] of [
    ["2027-02-24", "2027-03-03"],
    ["2028-02-24", "2028-03-03"],
    ["2026-12-20", "2027-03-03"],
  ]) {
    const covered = [];
    for (const [segmentStart, spanDays] of segments(start, end)) {
      const date = new Date(`${segmentStart}T12:00:00Z`);
      assert.ok(date.getUTCDay() + spanDays <= 7);
      for (let offset = 0; offset < spanDays; offset += 1) {
        const dateKey = date.toISOString().slice(0, 10);
        assert.ok(dateKey <= end);
        covered.push(dateKey);
        date.setUTCDate(date.getUTCDate() + 1);
      }
      assert.equal(
        calendarEventSegment({ start, end }, covered.at(-1)).isSegmentEnd,
        true,
      );
    }
    const expectedDays = (Date.parse(end) - Date.parse(start)) / 86_400_000 + 1;
    assert.equal(covered[0], start);
    assert.equal(covered.at(-1), end);
    assert.equal(covered.length, expectedDays);
    assert.equal(new Set(covered).size, expectedDays);
  }
});
