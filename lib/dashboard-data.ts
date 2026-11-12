import type { UserCode } from "../app/oip-types";
import type { OipDataSnapshot } from "./client-data-cache";
import { calendarDateKey, calendarEventsInRange } from "./calendar-recurrence";
import { systemCalendarEventsForYear } from "./calendar-reminders";

const DAY_MS = 86_400_000;

export function dashboardDateOffset(key: string, days: number) {
  return new Date(Date.parse(`${key}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

export function dashboardDaysUntil(date: string, today: string) {
  return Math.round((Date.parse(`${calendarDateKey(date)}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY_MS);
}

export function buildDashboardData(data: OipDataSnapshot, today: string, user: UserCode) {
  const [year, month] = today.split("-").map(Number);
  const first = `${today.slice(0, 7)}-01`;
  const weekday = new Date(`${first}T00:00:00Z`).getUTCDay();
  const gridStart = dashboardDateOffset(first, -weekday);
  const gridEnd = dashboardDateOffset(gridStart, 41);
  const agendaEnd = dashboardDateOffset(today, 7);
  const visibleToUser = (item: { visibility: string; author_id: string }) => item.visibility === "shared" || item.author_id === user;
  const occurrences = calendarEventsInRange(
    data.events.filter(visibleToUser), gridStart, gridEnd > agendaEnd ? gridEnd : agendaEnd,
    [year - 1, year, year + 1].flatMap(systemCalendarEventsForYear),
  ).sort((a, b) => Number(b.is_all_day) - Number(a.is_all_day) || a.start_at.localeCompare(b.start_at));

  function day(key: string) {
    return {
      key,
      events: occurrences.filter((event) => calendarDateKey(event.start_at) <= key && calendarDateKey(event.end_at ?? event.start_at) >= key),
      daysOff: data.daysOff.filter((item) => item.date === key),
      holidays: data.holidays.filter((item) => item.date === key),
    };
  }

  const todos = data.todos.filter((item) => !item.is_completed && visibleToUser(item)).sort((a, b) =>
    (a.due_at ?? "9999").localeCompare(b.due_at ?? "9999") || (b.created_at ?? "").localeCompare(a.created_at ?? ""),
  );
  const fridge = data.fridge.filter((item) => !item.consumed_at).sort((a, b) => a.expiration_date.localeCompare(b.expiration_date));
  return {
    today, year, month,
    monthDays: Array.from({ length: 42 }, (_, index) => day(dashboardDateOffset(gridStart, index))),
    agenda: Array.from({ length: 8 }, (_, index) => day(dashboardDateOffset(today, index)))
      .filter((item, index) => index === 0 || item.events.length || item.daysOff.length || item.holidays.length),
    todos,
    overdueTodos: todos.filter((item) => item.due_at && calendarDateKey(item.due_at) < today).length,
    shopping: data.shopping.filter((item) => !item.is_purchased),
    trips: data.trips.filter((trip) => trip.end_date >= today).sort((a, b) => a.start_date.localeCompare(b.start_date)),
    wishlist: (data.travelWishlist ?? []).filter((item) => !item.is_completed),
    fridge,
    urgentFridge: fridge.filter((item) => dashboardDaysUntil(item.expiration_date, today) <= 3).length,
    parking: data.parking,
  };
}
