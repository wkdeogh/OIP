type DateRange = { start: string; end: string };

export function calendarEventSegment(range: DateRange, dateKey: string) {
  const date = new Date(`${dateKey}T12:00:00Z`);
  const dayOfWeek = date.getUTCDay();
  const isRange = range.start !== range.end;
  const isSegmentStart =
    isRange && (range.start === dateKey || dayOfWeek === 0);
  const isSegmentEnd =
    isRange && (range.end === dateKey || dayOfWeek === 6);
  const remainingDays =
    (Date.parse(`${range.end}T12:00:00Z`) - date.getTime()) / 86_400_000 + 1;
  const spanDays = isSegmentStart
    ? Math.min(7 - dayOfWeek, remainingDays)
    : 1;

  return { isRange, isSegmentStart, isSegmentEnd, spanDays };
}
