import type { CalendarEvent } from "@/app/oip-types";

export type RecurrenceFrequency = "MONTHLY" | "YEARLY";
export type Recurrence = { frequency: RecurrenceFrequency; until: string | null };
type RecurringEvent = Pick<CalendarEvent, "id" | "start_at" | "end_at" | "recurrence_rule">;
export type CalendarOccurrence<T> = T & { source_event_id?: string };

const DAY_MS = 86_400_000;
const seoulFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
});

export function calendarDateKey(timestamp: string) {
  if (!timestamp.includes("T")) return timestamp.slice(0, 10);
  const parts = seoulFormatter.formatToParts(new Date(timestamp));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function isCalendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function parseRecurrenceRule(rule?: string | null): Recurrence | null {
  if (!rule) return null;
  const match = /^FREQ=(MONTHLY|YEARLY)(?:;UNTIL=(\d{4})(\d{2})(\d{2}))?$/.exec(rule);
  if (!match) return null;
  const until = match[2] ? `${match[2]}-${match[3]}-${match[4]}` : null;
  if (until && !isCalendarDate(until)) return null;
  return { frequency: match[1] as RecurrenceFrequency, until };
}

export function recurrenceRule(frequency: RecurrenceFrequency | null, until = "") {
  return frequency ? `FREQ=${frequency}${until ? `;UNTIL=${until.replaceAll("-", "")}` : ""}` : null;
}

export function recurrenceLabel(rule?: string | null, start?: string) {
  const recurrence = parseRecurrenceRule(rule);
  if (!recurrence) return "반복 안 함";
  if (!start) return recurrence.frequency === "MONTHLY" ? "매월" : "매년";
  const [, month, day] = calendarDateKey(start).split("-").map(Number);
  return recurrence.frequency === "MONTHLY" ? `매월 ${day}일` : `매년 ${month}월 ${day}일`;
}

export function sourceEventId(event: { id: string; source_event_id?: string }) {
  return event.source_event_id ?? event.id;
}

function dateEpoch(key: string) {
  return new Date(`${key}T00:00:00Z`).getTime();
}

function clampedDate(year: number, month: number, day: number) {
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return `${String(year).padStart(4, "0")}-${String(month + 1).padStart(2, "0")}-${String(Math.min(day, lastDay)).padStart(2, "0")}`;
}

/** Expand only occurrences intersecting the requested dates, in Seoul time.
 * Missing month/leap days use the last day, always relative to the original anchor.
 * UNTIL includes occurrences starting on that date; multi-day duration is preserved.
 */
export function expandCalendarEvents<T extends RecurringEvent>(
  events: readonly T[], from: string, to: string,
): CalendarOccurrence<T>[] {
  if (!isCalendarDate(from) || !isCalendarDate(to) || from > to) return [];
  const result: CalendarOccurrence<T>[] = [];
  for (const event of events) {
    const startMs = new Date(event.start_at).getTime();
    const endMs = event.end_at ? new Date(event.end_at).getTime() : startMs;
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) continue;
    const start = calendarDateKey(event.start_at);
    const end = event.end_at ? calendarDateKey(event.end_at) : start;
    const recurrence = parseRecurrenceRule(event.recurrence_rule);
    if (!recurrence) {
      if (start <= to && end >= from) result.push(event);
      continue;
    }
    if (start > to) continue;
    const [anchorYear, anchorMonth, anchorDay] = start.split("-").map(Number);
    const durationDays = (dateEpoch(end) - dateEpoch(start)) / DAY_MS;
    const earliest = new Date(dateEpoch(from) - durationDays * DAY_MS);
    const firstMonth = anchorYear * 12 + anchorMonth - 1;
    const step = recurrence.frequency === "MONTHLY" ? 1 : 12;
    // Jump to the first potentially overlapping period, even for old series.
    let index = Math.max(0, Math.floor(
      (earliest.getUTCFullYear() * 12 + earliest.getUTCMonth() - firstMonth) / step,
    ));
    for (;; index += 1) {
      const totalMonth = firstMonth + index * step;
      const occurrenceDate = clampedDate(Math.floor(totalMonth / 12), totalMonth % 12, anchorDay);
      if (occurrenceDate > to || (recurrence.until && occurrenceDate > recurrence.until)) break;
      const delta = dateEpoch(occurrenceDate) - dateEpoch(start);
      const occurrenceEnd = new Date(dateEpoch(end) + delta).toISOString().slice(0, 10);
      if (occurrenceEnd < from) continue;
      result.push({
        ...event,
        id: `${event.id}@${occurrenceDate}`,
        source_event_id: event.id,
        start_at: new Date(startMs + delta).toISOString(),
        end_at: event.end_at ? new Date(endMs + delta).toISOString() : event.end_at,
      });
    }
  }
  return result;
}

export function recurrencePreview(start: string, rule: string | null) {
  if (!rule || !isCalendarDate(start)) return [];
  return expandCalendarEvents([
    { id: "preview", start_at: `${start}T12:00:00+09:00`, recurrence_rule: rule },
  ], start, `${Number(start.slice(0, 4)) + 3}-12-31`)
    .slice(0, 3).map((event) => calendarDateKey(event.start_at));
}
