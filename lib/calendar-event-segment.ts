type DateRange = { start: string; end: string };

export function calendarEventSegment(range: DateRange, dateKey: string) {
  const date = new Date(`${dateKey}T12:00:00Z`);
  const dayOfMonth = date.getUTCDate();
  const dayOfWeek = date.getUTCDay();
  const daysInMonth = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
  ).getUTCDate();
  const isRange = range.start !== range.end;
  // Outside-month cells are faded as a group, so spans must restart at month boundaries.
  const isSegmentStart =
    isRange && (range.start === dateKey || dayOfWeek === 0 || dayOfMonth === 1);
  const isSegmentEnd =
    isRange &&
    (range.end === dateKey || dayOfWeek === 6 || dayOfMonth === daysInMonth);
  const remainingDays =
    (Date.parse(`${range.end}T12:00:00Z`) - date.getTime()) / 86_400_000 + 1;
  const spanDays = isSegmentStart
    ? Math.min(7 - dayOfWeek, daysInMonth - dayOfMonth + 1, remainingDays)
    : 1;

  return { isRange, isSegmentStart, isSegmentEnd, spanDays };
}
