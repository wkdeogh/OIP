"use client";

import { useState } from "react";
import {
  parseRecurrenceRule,
  recurrenceLabel,
  recurrencePreview,
  recurrenceRule,
  type RecurrenceFrequency,
} from "@/lib/calendar-recurrence";

const OPTIONS = [
  { value: "", label: "반복 안 함" },
  { value: "MONTHLY", label: "매월" },
  { value: "YEARLY", label: "매년" },
] as const;

export function EventRecurrenceFields({ start, initialRule }: {
  start: string;
  initialRule?: string | null;
}) {
  const initial = parseRecurrenceRule(initialRule);
  const [frequency, setFrequency] = useState<RecurrenceFrequency | null>(initial?.frequency ?? null);
  const [hasEnd, setHasEnd] = useState(Boolean(initial?.until));
  const [until, setUntil] = useState(initial?.until ?? start);
  const rule = recurrenceRule(frequency, hasEnd ? until : "");
  const preview = recurrencePreview(start, rule);
  const [, month, day] = start.split("-").map(Number);
  const needsClamp = frequency === "MONTHLY" ? day >= 29 : month === 2 && day === 29;

  return (
    <section className="event-recurrence-section" aria-label="일정 반복 설정">
      <input name="recurrence_rule" readOnly type="hidden" value={rule ?? ""} />
      <fieldset className="event-recurrence-options">
        <legend><span aria-hidden="true">↻</span> 반복</legend>
        <div className="event-recurrence-segments">
          {OPTIONS.map((option) => (
            <label className={frequency === (option.value || null) ? "is-selected" : ""} key={option.value}>
              <input
                checked={frequency === (option.value || null)}
                name="recurrence_frequency"
                onChange={() => setFrequency(option.value || null)}
                type="radio"
                value={option.value}
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
      </fieldset>
      {frequency ? (
        <div className="event-recurrence-details">
          <p className="event-recurrence-summary" aria-live="polite">
            {recurrenceLabel(rule, start)}에 반복해요.
            {needsClamp ? <small>해당 날짜가 없는 달에는 그달의 마지막 날에 표시해요.</small> : null}
          </p>
          <div className="event-recurrence-end">
            <label htmlFor="recurrence-end-mode">반복 종료</label>
            <select
              id="recurrence-end-mode"
              value={hasEnd ? "date" : "never"}
              onChange={(event) => setHasEnd(event.target.value === "date")}
            >
              <option value="never">종료일 없음</option>
              <option value="date">날짜 지정</option>
            </select>
          </div>
          {hasEnd ? (
            <label className="field event-recurrence-until">
              <span>마지막 반복 시작일</span>
              <input
                aria-describedby="recurrence-until-hint"
                min={start}
                onChange={(event) => setUntil(event.target.value)}
                required
                type="date"
                value={until}
              />
              <small id="recurrence-until-hint">이 날짜에 시작하는 일정까지 포함해요.</small>
            </label>
          ) : null}
          {preview.length ? (
            <div className="event-recurrence-preview" aria-live="polite">
              <small>반복 미리보기</small>
              <div>{preview.map((date) => (
                <span key={date}>{Number(date.slice(0, 4))}년 {Number(date.slice(5, 7))}월 {Number(date.slice(8, 10))}일</span>
              ))}</div>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
