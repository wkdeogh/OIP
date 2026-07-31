import type { CalendarEvent, UserCode } from "@/app/oip-types";

export const SYSTEM_ANNIVERSARIES = [
  { day: "04-15", title: "대호 생일" },
  { day: "05-06", title: "상희 생일" },
  { day: "08-30", title: "결혼기념일" },
  { day: "11-17", title: "만난 날 기념일" },
] as const;

export type CalendarReminderEvent = Pick<
  CalendarEvent,
  | "id"
  | "title"
  | "start_at"
  | "end_at"
  | "is_all_day"
  | "visibility"
  | "author_id"
  | "event_type"
>;

export function seoulDateKey(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

export function nextDateKey(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

export function seoulDayBounds(dateKey: string) {
  return {
    start: new Date(`${dateKey}T00:00:00+09:00`).toISOString(),
    end: new Date(`${nextDateKey(dateKey)}T00:00:00+09:00`).toISOString(),
  };
}

export function systemAnniversariesForDate(
  dateKey: string,
): CalendarReminderEvent[] {
  const year = dateKey.slice(0, 4);
  const monthDay = dateKey.slice(5);
  return SYSTEM_ANNIVERSARIES.filter((item) => item.day === monthDay).map(
    (item) => ({
      id: `system-${year}-${item.day}`,
      title: item.title,
      start_at: `${dateKey}T00:00:00+09:00`,
      end_at: null,
      is_all_day: true,
      visibility: "shared",
      author_id: "system",
      event_type: "anniversary",
    }),
  );
}

export function visibleReminderEvents(
  events: CalendarReminderEvent[],
  user: UserCode,
) {
  return events.filter(
    (event) => event.visibility === "shared" || event.author_id === user,
  );
}

function eventTimeLabel(event: CalendarReminderEvent, dateKey: string) {
  if (event.is_all_day) return "하루 종일";
  if (seoulDateKey(event.start_at) < dateKey) return "진행 중";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(event.start_at));
}

export function calendarReminderPayload(
  events: CalendarReminderEvent[],
  dateKey: string,
) {
  const summaries = [...events]
    .sort((left, right) => left.start_at.localeCompare(right.start_at))
    .map((event) => `${eventTimeLabel(event, dateKey)} ${event.title}`);
  const visible = summaries.slice(0, 3);
  const remaining = summaries.length - visible.length;
  return {
    title: `오늘 일정 ${events.length}개`,
    body: `${visible.join(" · ")}${remaining > 0 ? ` · 외 ${remaining}개` : ""}`,
    date: dateKey,
    url: `/?date=${dateKey}`,
  };
}
