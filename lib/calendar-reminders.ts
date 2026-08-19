import type { CalendarEvent, UserCode } from "@/app/oip-types";

export const SYSTEM_ANNIVERSARIES = [
  { day: "04-15", title: "대호 생일" },
  { day: "05-06", title: "상희 생일" },
  { day: "08-30", title: "결혼기념일" },
  { day: "11-17", title: "만난 날 기념일" },
] as const;

export const SYSTEM_LUNAR_EVENTS = [
  { month: 7, day: 12, title: "김해엄마생신" },
  { month: 4, day: 19, title: "김해아빠생신" },
  { month: 4, day: 28, title: "서울아빠생신" },
] as const;

export const SYSTEM_SOLAR_EVENTS = [
  { day: "08-15", title: "서울엄마생신" },
] as const;

const SYSTEM_BIRTHDAY_EVENT_COLOR = "#9C6ADE";
const systemCalendarEventsByYear = new Map<number, CalendarEvent[]>();
const koreanLunarPartsFormatter = new Intl.DateTimeFormat(
  "ko-KR-u-ca-dangi",
  {
    month: "long",
    day: "numeric",
    timeZone: "Asia/Seoul",
  },
);

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

function koreanLunarMonthDay(dateKey: string) {
  const parts = koreanLunarPartsFormatter.formatToParts(
    new Date(`${dateKey}T12:00:00+09:00`),
  );
  const monthText = parts.find((part) => part.type === "month")?.value ?? "";
  const dayText = parts.find((part) => part.type === "day")?.value ?? "";
  const monthMatch = monthText.match(/^(윤)?(\d+)월$/);
  return {
    month: Number(monthMatch?.[2] ?? 0),
    day: Number(dayText),
    isLeapMonth: Boolean(monthMatch?.[1]),
  };
}

export function systemCalendarEventsForYear(year: number) {
  const cached = systemCalendarEventsByYear.get(year);
  if (cached) return cached;

  const events: CalendarEvent[] = [
    ...SYSTEM_ANNIVERSARIES.map(({ day, title }) => ({
      id: `system-${year}-${day}`,
      title,
      start_at: `${year}-${day}T00:00:00+09:00`,
      end_at: null,
      is_all_day: true,
      visibility: "shared" as const,
      author_id: "system" as const,
      event_type: "anniversary" as const,
    })),
    ...SYSTEM_SOLAR_EVENTS.map(({ day, title }) => ({
      id: `system-solar-${year}-${day}`,
      title,
      start_at: `${year}-${day}T00:00:00+09:00`,
      end_at: null,
      is_all_day: true,
      visibility: "shared" as const,
      author_id: "system" as const,
      event_type: "normal" as const,
      custom_color: SYSTEM_BIRTHDAY_EVENT_COLOR,
    })),
  ];

  let dateKey = `${year}-01-01`;
  while (dateKey.startsWith(`${year}-`)) {
    const lunarDate = koreanLunarMonthDay(dateKey);
    if (!lunarDate.isLeapMonth) {
      SYSTEM_LUNAR_EVENTS.forEach((event) => {
        if (event.month !== lunarDate.month || event.day !== lunarDate.day) {
          return;
        }
        events.push({
          id: `system-lunar-${year}-${event.month}-${event.day}`,
          title: event.title,
          start_at: `${dateKey}T00:00:00+09:00`,
          end_at: null,
          is_all_day: true,
          visibility: "shared",
          author_id: "system",
          event_type: "normal",
          custom_color: SYSTEM_BIRTHDAY_EVENT_COLOR,
        });
      });
    }
    dateKey = nextDateKey(dateKey);
  }

  systemCalendarEventsByYear.set(year, events);
  return events;
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
  return systemCalendarEventsForYear(Number(dateKey.slice(0, 4))).filter(
    (event) => event.start_at.slice(0, 10) === dateKey,
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
  if (event.is_all_day) return "";
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
    .map((event) => {
      const timeLabel = eventTimeLabel(event, dateKey);
      return timeLabel ? `${timeLabel} ${event.title}` : event.title;
    });
  const visible = summaries.slice(0, 3);
  const remaining = summaries.length - visible.length;
  return {
    title: "",
    body: `${visible.join(" · ")}${remaining > 0 ? ` · 외 ${remaining}개` : ""}`,
    date: dateKey,
    url: `/?date=${dateKey}`,
  };
}
