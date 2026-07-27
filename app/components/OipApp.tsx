"use client";

import {
  FormEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import type {
  CalendarEvent,
  DayOff,
  FridgeItem,
  ParkingRecord,
  PublicHoliday,
  RandomCandidate,
  ShoppingItem,
  Todo,
  Trip,
  TripAccommodation,
  TripFlight,
  TripFood,
  TripPlace,
  TripTransportation,
  UserCode,
  Visibility,
} from "../oip-types";

type MainTab = "schedule" | "travel" | "fridge" | "parking" | "etc";
type ScheduleTab = "calendar" | "todo" | "shopping";
type ThemeMode = "light" | "dark";
type ModalName = "event" | "dayoff" | "trip" | "fridge" | null;
type DateRange = { start: string; end: string };
type CalendarEventScope = "shared" | "personal" | "private";
type DateRangeSelection = "start" | "end";
type TripSection =
  | "overview"
  | "trip_flights"
  | "trip_accommodations"
  | "trip_transportations"
  | "trip_foods"
  | "trip_places";
type TripDetailResource = Exclude<TripSection, "overview">;
type TripDetailItem =
  | TripFlight
  | TripAccommodation
  | TripTransportation
  | TripFood
  | TripPlace;

const USER_META: Record<
  UserCode,
  { name: string; short: string; color: string }
> = {
  daeho: { name: "대호", short: "대", color: "#7fa99b" },
  sanghee: { name: "상희", short: "상", color: "#e9a6ad" },
};

const EVENT_COLOR_OPTIONS = [
  { name: "기본색", value: "" },
  { name: "노랑", value: "#F6D875" },
  { name: "파랑", value: "#A8D5F2" },
  { name: "초록", value: "#A8DDB8" },
  { name: "보라", value: "#CEB7EC" },
  { name: "분홍", value: "#F5B7C3" },
  { name: "주황", value: "#F7C49A" },
  { name: "코랄", value: "#F4A6A0" },
  { name: "회색", value: "#CCD3DB" },
] as const;

const MAIN_TABS: Array<{
  id: MainTab;
  label: string;
  icon: string;
  title: string;
}> = [
  { id: "schedule", label: "일정", icon: "▦", title: "일정" },
  { id: "travel", label: "여행", icon: "✈", title: "여행" },
  { id: "fridge", label: "냉장고", icon: "□", title: "냉장고" },
  { id: "parking", label: "주차장", icon: "P", title: "주차장" },
  { id: "etc", label: "ETC", icon: "✦", title: "생활 도구" },
];

function toDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(offset: number) {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + offset);
  return toDateKey(date);
}

function parseDateKey(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

function dateKeyInSeoul(value: string) {
  if (!value.includes("T")) return value.slice(0, 10);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function timeInSeoul(value: string) {
  if (!value.includes("T")) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(11, 16);
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

function toSeoulTimestamp(value: string) {
  return value ? `${value}:00+09:00` : null;
}

function normalizeRange(start: string, end: string): DateRange {
  return start <= end ? { start, end } : { start: end, end: start };
}

function monthCalendarDays(month: Date) {
  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const firstWeekday = new Date(year, monthIndex, 1).getDay();
  const firstCell = new Date(year, monthIndex, 1 - firstWeekday, 12);
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(firstCell);
    date.setDate(firstCell.getDate() + index);
    return date;
  });
}

function eventDateRange(event: CalendarEvent): DateRange {
  return normalizeRange(
    dateKeyInSeoul(event.start_at),
    event.end_at ? dateKeyInSeoul(event.end_at) : dateKeyInSeoul(event.start_at),
  );
}

function eventCoversDate(event: CalendarEvent, date: string) {
  const range = eventDateRange(event);
  return date >= range.start && date <= range.end;
}

function calendarEventLaneKey(weekIndex: number, eventId: string) {
  return `${weekIndex}:${eventId}`;
}

function buildCalendarEventLanes(events: CalendarEvent[], days: Date[]) {
  const lanes = new Map<string, number>();

  for (let weekIndex = 0; weekIndex < 6; weekIndex += 1) {
    const weekStart = toDateKey(days[weekIndex * 7]);
    const weekEnd = toDateKey(days[weekIndex * 7 + 6]);
    const segments = events
      .filter((event) => event.event_type !== "anniversary")
      .map((event) => {
        const range = eventDateRange(event);
        return {
          event,
          start: range.start < weekStart ? weekStart : range.start,
          end: range.end > weekEnd ? weekEnd : range.end,
        };
      })
      .filter((segment) => segment.start <= segment.end)
      .sort(
        (left, right) =>
          left.start.localeCompare(right.start) ||
          right.end.localeCompare(left.end) ||
          left.event.title.localeCompare(right.event.title, "ko"),
      );
    const laneEnds: string[] = [];

    segments.forEach((segment) => {
      let lane = laneEnds.findIndex((end) => end < segment.start);
      if (lane === -1) lane = laneEnds.length;
      laneEnds[lane] = segment.end;
      lanes.set(calendarEventLaneKey(weekIndex, segment.event.id), lane);
    });
  }

  return lanes;
}

function anniversaryEmoji(title: string) {
  if (title.includes("만난")) return "❤️";
  if (title.includes("결혼")) return "💍";
  return "🎂";
}

function calendarEventScope(event: CalendarEvent): CalendarEventScope {
  if (event.visibility === "private") return "private";
  return event.color_mode === "custom" ? "personal" : "shared";
}

function calendarEventColor(event: CalendarEvent) {
  const scope = calendarEventScope(event);
  return scope === "personal" ? event.author_id : scope;
}

function defaultEventColor(scope: CalendarEventScope, user: UserCode) {
  if (scope === "shared") return "var(--shared-soft)";
  if (scope === "private") return "var(--private-soft)";
  return user === "daeho" ? "var(--daeho-soft)" : "var(--sanghee-soft)";
}

function newId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

function formatKoreanDate(value: string, includeYear = false) {
  const date = parseDateKey(dateKeyInSeoul(value));
  return new Intl.DateTimeFormat("ko-KR", {
    ...(includeYear ? { year: "numeric" as const } : {}),
    month: "short",
    day: "numeric",
    weekday: "short",
  }).format(date);
}

function formatEventDateSummary(range: DateRange) {
  const formatter = new Intl.DateTimeFormat("ko-KR", {
    month: "long",
    day: "numeric",
    weekday: "short",
  });
  const start = formatter.format(parseDateKey(range.start));
  if (range.start === range.end) return start;
  return `${start} – ${formatter.format(parseDateKey(range.end))}`;
}

function formatDatePickerDetail(value: string) {
  const date = parseDateKey(value);
  return {
    day: date.getDate(),
    month: `${date.getFullYear()}년 ${date.getMonth() + 1}월`,
    weekday: new Intl.DateTimeFormat("ko-KR", { weekday: "long" }).format(date),
  };
}

function addOneHour(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  const total = Math.min(hour * 60 + minute + 60, 23 * 60 + 59);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(
    total % 60,
  ).padStart(2, "0")}`;
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function toDateTimeInput(value?: string | null) {
  return value ? `${dateKeyInSeoul(value)}T${timeInSeoul(value)}` : "";
}

function daysUntil(value: string) {
  const today = parseDateKey(toDateKey(new Date()));
  return Math.round(
    (parseDateKey(value).getTime() - today.getTime()) / 86_400_000,
  );
}

function expiryLabel(value: string) {
  const days = daysUntil(value);
  if (days === 0) return "오늘까지";
  if (days > 0) return `D-${days}`;
  return `${Math.abs(days)}일 지남`;
}

const seedEvents: CalendarEvent[] = [
  {
    id: "event-health",
    title: "건강검진",
    start_at: `${addDays(2)}T09:30:00+09:00`,
    is_all_day: false,
    visibility: "shared",
    author_id: "daeho",
    event_type: "normal",
    color_mode: "custom",
  },
  {
    id: "event-dinner",
    title: "저녁 약속",
    start_at: `${addDays(4)}T18:30:00+09:00`,
    is_all_day: false,
    visibility: "shared",
    author_id: "sanghee",
    event_type: "normal",
  },
  {
    id: "event-family",
    title: "가족 모임",
    start_at: `${addDays(7)}T12:00:00+09:00`,
    is_all_day: true,
    visibility: "shared",
    author_id: "daeho",
    event_type: "normal",
  },
];

const seedDaysOff: DayOff[] = [
  {
    id: "off-daeho",
    date: addDays(5),
    owner_id: "daeho",
    day_off_type: "연차",
  },
  {
    id: "off-sanghee",
    date: addDays(5),
    owner_id: "sanghee",
    day_off_type: "해피프라이데이",
  },
];

const seedTodos: Todo[] = [
  {
    id: "todo-1",
    title: "자동차 보험 갱신 확인",
    memo: "주말 전에 비교하기",
    due_at: addDays(3),
    is_completed: false,
    visibility: "shared",
    author_id: "daeho",
  },
  {
    id: "todo-2",
    title: "여행용 보조배터리 챙기기",
    due_at: addDays(9),
    is_completed: false,
    visibility: "shared",
    author_id: "sanghee",
  },
  {
    id: "todo-3",
    title: "택배 반품",
    is_completed: true,
    completed_at: new Date().toISOString(),
    visibility: "private",
    author_id: "daeho",
  },
];

const seedShopping: ShoppingItem[] = [
  {
    id: "shopping-1",
    name: "우유",
    quantity: 2,
    unit: "개",
    category: "식품",
    is_purchased: false,
    added_by: "sanghee",
  },
  {
    id: "shopping-2",
    name: "세탁세제",
    quantity: 1,
    unit: "통",
    category: "생활용품",
    is_purchased: false,
    added_by: "daeho",
  },
  {
    id: "shopping-3",
    name: "달걀",
    quantity: 1,
    unit: "판",
    category: "식품",
    is_purchased: true,
    added_by: "sanghee",
    purchased_by: "daeho",
    purchased_at: new Date().toISOString(),
  },
];

const seedTrips: Trip[] = [
  {
    id: "trip-kyoto",
    title: "늦여름 교토",
    destination: "일본 교토",
    start_date: addDays(27),
    end_date: addDays(30),
    memo: "오랜만에 천천히 걷는 여행",
    author_id: "sanghee",
  },
  {
    id: "trip-jeju",
    title: "제주 봄 여행",
    destination: "제주",
    start_date: addDays(-92),
    end_date: addDays(-89),
    memo: "동쪽 해안 드라이브",
    author_id: "daeho",
  },
];

const seedFridge: FridgeItem[] = [
  {
    id: "fridge-1",
    name: "그릭요거트",
    quantity: 2,
    unit: "개",
    expiration_date: addDays(1),
    storage_type: "냉장",
    category: "유제품",
    author_id: "sanghee",
  },
  {
    id: "fridge-2",
    name: "두부",
    quantity: 1,
    unit: "모",
    expiration_date: addDays(3),
    storage_type: "냉장",
    category: "식재료",
    author_id: "daeho",
  },
  {
    id: "fridge-3",
    name: "냉동 만두",
    quantity: 1,
    unit: "봉",
    expiration_date: addDays(42),
    storage_type: "냉동",
    category: "간편식",
    author_id: "daeho",
  },
];

const seedParking: ParkingRecord = {
  id: "parking-1",
  floor: "B5",
  pillar_letter: "C",
  pillar_number: 4,
  author_id: "daeho",
  created_at: new Date(Date.now() - 52 * 60 * 1000).toISOString(),
};

const seedCandidates: RandomCandidate[] = [
  {
    id: "candidate-1",
    type: "destination",
    name: "강릉",
    category: "국내",
    is_active: true,
    author_id: "daeho",
  },
  {
    id: "candidate-2",
    type: "destination",
    name: "타이베이",
    category: "해외",
    is_active: true,
    author_id: "sanghee",
  },
  {
    id: "candidate-3",
    type: "destination",
    name: "통영",
    category: "국내",
    is_active: true,
    author_id: "sanghee",
  },
  {
    id: "candidate-4",
    type: "meal",
    name: "김치찌개",
    category: "한식",
    is_active: true,
    author_id: "daeho",
  },
  {
    id: "candidate-5",
    type: "meal",
    name: "초밥",
    category: "일식",
    is_active: true,
    author_id: "sanghee",
  },
  {
    id: "candidate-6",
    type: "meal",
    name: "마라탕",
    category: "중식",
    is_active: true,
    author_id: "daeho",
  },
];

function CloverLogo({ large = false }: { large?: boolean }) {
  return (
    <span
      className={`clover-logo${large ? " clover-logo--large" : ""}`}
      aria-hidden="true"
    />
  );
}

function LoadingScreen() {
  return (
    <main className="gate-screen" aria-busy="true">
      <section className="gate-card loading-card">
        <CloverLogo large />
        <div className="skeleton-line skeleton-line--title" />
        <div className="skeleton-line" />
        <div className="skeleton-button" />
        <span className="sr-only">불러오는 중</span>
      </section>
    </main>
  );
}

function DataLoadingSkeleton() {
  return (
    <div className="data-loading" aria-busy="true" aria-label="데이터 불러오는 중">
      <div className="sub-tabs data-loading-tabs" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <div className="calendar-layout">
        <section className="card calendar-card data-loading-calendar">
          <div className="data-loading-toolbar">
            <span />
            <strong />
            <span />
          </div>
          <div className="calendar-weekdays" aria-hidden="true">
            {["일", "월", "화", "수", "목", "금", "토"].map((day) => (
              <span key={day}>{day}</span>
            ))}
          </div>
          <div className="data-loading-grid" aria-hidden="true">
            {Array.from({ length: 42 }, (_, index) => (
              <span className="data-loading-day" key={index}>
                <i />
                {index % 4 === 0 ? <b /> : null}
              </span>
            ))}
          </div>
        </section>
      </div>
      <span className="sr-only">일정과 생활 데이터를 불러오고 있습니다.</span>
    </div>
  );
}

function PasswordGate({
  onAuthenticated,
  theme,
  onToggleTheme,
}: {
  onAuthenticated: () => void;
  theme: ThemeMode;
  onToggleTheme: () => void;
}) {
  const showLocalHint = process.env.NODE_ENV === "development";
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!password) {
      setError("비밀번호를 입력해 주세요.");
      return;
    }
    setIsSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(data.error ?? "비밀번호를 확인해 주세요.");
        return;
      }
      onAuthenticated();
    } catch {
      setError("연결을 확인하고 다시 시도해 주세요.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="gate-screen">
      <div className="gate-theme-toggle">
        <ThemeToggleButton onToggle={onToggleTheme} theme={theme} />
      </div>
      <section className="gate-card">
        <div className="gate-brand">
          <CloverLogo large />
          <div>
            <h1>OIP</h1>
          </div>
        </div>
        <p className="gate-copy">
          대호와 상희가 함께 쓰는 공간이에요.
          <br />
          공통 비밀번호를 입력해 주세요.
        </p>
        <form onSubmit={submit} noValidate>
          <label className="field">
            <span>비밀번호</span>
            <input
              autoFocus
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? "password-error" : undefined}
              placeholder="비밀번호 입력"
            />
          </label>
          {error ? (
            <p className="field-error" id="password-error" role="alert">
              {error}
            </p>
          ) : showLocalHint ? (
            <p className="local-hint">
              로컬 미리보기 비밀번호는 <strong>oip</strong>입니다.
            </p>
          ) : null}
          <button
            className="button button--primary button--full"
            disabled={isSubmitting}
            type="submit"
          >
            {isSubmitting ? "확인 중…" : "확인"}
          </button>
        </form>
      </section>
    </main>
  );
}

function UserGate({
  onSelect,
  theme,
  onToggleTheme,
}: {
  onSelect: (user: UserCode) => void;
  theme: ThemeMode;
  onToggleTheme: () => void;
}) {
  return (
    <main className="gate-screen">
      <div className="gate-theme-toggle">
        <ThemeToggleButton onToggle={onToggleTheme} theme={theme} />
      </div>
      <section className="gate-card">
        <CloverLogo large />
        <p className="eyebrow">OIP</p>
        <h1 className="user-gate-title">누가 사용 중인가요?</h1>
        <div className="user-choice-grid">
          {(Object.keys(USER_META) as UserCode[]).map((code) => (
            <button
              className={`user-choice user-choice--${code}`}
              key={code}
              onClick={() => onSelect(code)}
              type="button"
            >
              <span className="avatar">{USER_META[code].short}</span>
              <strong>{USER_META[code].name}</strong>
            </button>
          ))}
        </div>
      </section>
    </main>
  );
}

function Modal({
  title,
  description,
  headerAction,
  className,
  onClose,
  children,
}: {
  title: string;
  description?: string;
  headerAction?: ReactNode;
  className?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        aria-labelledby="modal-title"
        aria-modal="true"
        className={`modal-card${className ? ` ${className}` : ""}`}
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="modal-head">
          <div>
            <h2 id="modal-title">{title}</h2>
            {description ? <p>{description}</p> : null}
          </div>
          <div className="modal-head-actions">
            {headerAction}
            <button
              aria-label="닫기"
              className="icon-button"
              onClick={onClose}
              type="button"
            >
              ×
            </button>
          </div>
        </div>
        {children}
      </section>
    </div>
  );
}

function EventVisibilityControls({
  scope,
  onChange,
}: {
  scope: CalendarEventScope;
  onChange: (scope: CalendarEventScope) => void;
}) {
  const isShared = scope === "shared";
  const isPrivate = scope === "private";
  return (
    <div className="modal-event-scopes">
      <label
        className={`modal-scope-toggle modal-scope-toggle--shared${
          isPrivate ? " is-disabled" : ""
        }`}
      >
        <input
          checked={isShared}
          disabled={isPrivate}
          onChange={(event) =>
            onChange(event.target.checked ? "shared" : "personal")
          }
          type="checkbox"
        />
        <span>공통일정</span>
      </label>
      <label className="modal-scope-toggle modal-scope-toggle--private">
        <input
          checked={isPrivate}
          onChange={(event) =>
            onChange(event.target.checked ? "private" : "personal")
          }
          type="checkbox"
        />
        <span>나만보기</span>
      </label>
    </div>
  );
}

function EventDateRangePicker({
  value,
  onApply,
  onClose,
}: {
  value: DateRange;
  onApply: (range: DateRange) => void;
  onClose: () => void;
}) {
  const initialDate = parseDateKey(value.start);
  const [draft, setDraft] = useState(value);
  const [selection, setSelection] = useState<DateRangeSelection>("start");
  const [visibleMonth, setVisibleMonth] = useState(
    new Date(initialDate.getFullYear(), initialDate.getMonth(), 1),
  );

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [onClose]);

  const days = monthCalendarDays(visibleMonth);
  const year = visibleMonth.getFullYear();
  const month = visibleMonth.getMonth();
  const startDetail = formatDatePickerDetail(draft.start);
  const endDetail = formatDatePickerDetail(draft.end);

  function chooseSelection(nextSelection: DateRangeSelection) {
    setSelection(nextSelection);
    const valueToShow =
      nextSelection === "start" ? draft.start : draft.end;
    const date = parseDateKey(valueToShow);
    setVisibleMonth(new Date(date.getFullYear(), date.getMonth(), 1));
  }

  function chooseDate(date: string) {
    if (selection === "start") {
      const next = { start: date, end: date };
      setDraft(next);
      setSelection("end");
      return;
    }

    if (date < draft.start) return;
    setDraft({ start: draft.start, end: date });
  }

  return createPortal(
    <div
      className="event-date-picker-backdrop"
      onMouseDown={onClose}
      role="presentation"
    >
      <section
        aria-label="일정 날짜 선택"
        aria-modal="true"
        className="event-date-picker"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="event-date-picker-handle" aria-hidden="true" />
        <div className="event-date-selection">
          <button
            aria-pressed={selection === "start"}
            className={selection === "start" ? "is-active" : ""}
            onClick={() => chooseSelection("start")}
            type="button"
          >
            <small>시작 날짜</small>
            <span>
              <strong>{startDetail.day}</strong>
              <span>
                {startDetail.month}
                <br />
                {startDetail.weekday}
              </span>
            </span>
          </button>
          <span className="event-date-selection-arrow" aria-hidden="true">
            →
          </span>
          <button
            aria-pressed={selection === "end"}
            className={selection === "end" ? "is-active" : ""}
            onClick={() => chooseSelection("end")}
            type="button"
          >
            <small>종료 날짜</small>
            <span>
              <strong>{endDetail.day}</strong>
              <span>
                {endDetail.month}
                <br />
                {endDetail.weekday}
              </span>
            </span>
          </button>
        </div>

        <div className="event-date-picker-toolbar">
          <strong>
            {year}년 {month + 1}월
          </strong>
          <div>
            <button
              aria-label="이전 달"
              onClick={() =>
                setVisibleMonth(new Date(year, month - 1, 1))
              }
              type="button"
            >
              ‹
            </button>
            <button
              aria-label="다음 달"
              onClick={() =>
                setVisibleMonth(new Date(year, month + 1, 1))
              }
              type="button"
            >
              ›
            </button>
          </div>
        </div>

        <div className="event-date-picker-weekdays" aria-hidden="true">
          {["일", "월", "화", "수", "목", "금", "토"].map((day) => (
            <span key={day}>{day}</span>
          ))}
        </div>
        <div className="event-date-picker-grid">
          {days.map((date) => {
            const key = toDateKey(date);
            const isOutside = date.getMonth() !== month;
            const isStart = key === draft.start;
            const isEnd = key === draft.end;
            const isInRange = key >= draft.start && key <= draft.end;
            const isToday = key === toDateKey(new Date());
            const isDisabled = selection === "end" && key < draft.start;

            return (
              <button
                aria-label={`${formatKoreanDate(key, true)}${
                  isDisabled ? ", 종료일로 선택할 수 없음" : ""
                }`}
                className={[
                  isOutside ? "is-outside" : "",
                  isInRange ? "is-in-range" : "",
                  isStart ? "is-start" : "",
                  isEnd ? "is-end" : "",
                  isToday ? "is-today" : "",
                  isDisabled ? "is-disabled" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                disabled={isDisabled}
                key={key}
                onClick={() => chooseDate(key)}
                type="button"
              >
                {date.getDate()}
              </button>
            );
          })}
        </div>

        <div className="event-date-picker-actions">
          <button className="button button--soft" onClick={onClose} type="button">
            취소
          </button>
          <button
            className="button button--primary"
            onClick={() => onApply(draft)}
            type="button"
          >
            적용
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}

function EventColorPicker({
  defaultColor,
  value,
  onClose,
  onSelect,
}: {
  defaultColor: string;
  value: string;
  onClose: () => void;
  onSelect: (color: string) => void;
}) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [onClose]);

  return createPortal(
    <div
      className="event-color-picker-backdrop"
      onMouseDown={onClose}
      role="presentation"
    >
      <section
        aria-label="일정 컬러 선택"
        aria-modal="true"
        className="event-color-picker"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="event-color-picker-handle" aria-hidden="true" />
        <header className="event-color-picker-head">
          <h3>컬러</h3>
          <button
            aria-label="컬러 선택 닫기"
            className="icon-button"
            onClick={onClose}
            type="button"
          >
            ×
          </button>
        </header>
        <div className="event-color-picker-options">
          {EVENT_COLOR_OPTIONS.map((option) => {
            const previewColor = option.value || defaultColor;
            const isSelected = option.value === value;
            return (
              <button
                aria-pressed={isSelected}
                className={isSelected ? "is-selected" : ""}
                key={option.name}
                onClick={() => {
                  onSelect(option.value);
                  onClose();
                }}
                type="button"
              >
                <span
                  className="event-color-picker-swatch"
                  style={{ backgroundColor: previewColor }}
                >
                  {isSelected ? "✓" : ""}
                </span>
                <strong>{option.name}</strong>
              </button>
            );
          })}
        </div>
      </section>
    </div>,
    document.body,
  );
}

function EventForm({
  currentUser,
  initialRange,
  scope,
  onSubmit,
}: {
  currentUser: UserCode;
  initialRange: DateRange;
  scope: CalendarEventScope;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const [range, setRange] = useState(initialRange);
  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);
  const [isColorPickerOpen, setIsColorPickerOpen] = useState(false);
  const [hasTime, setHasTime] = useState(false);
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("10:00");
  const [color, setColor] = useState("");
  const baseColor = defaultEventColor(scope, currentUser);
  const selectedColorName =
    EVENT_COLOR_OPTIONS.find((option) => option.value === color)?.name ??
    "기본색";

  function blurActiveInput() {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  }

  function toggleTime() {
    blurActiveInput();
    setHasTime((value) => !value);
  }

  return (
    <>
      <form
        className="modal-form event-form"
        id="event-form"
        onSubmit={onSubmit}
      >
        <label className="field event-title-field">
          <input
            aria-label="일정 제목"
            autoFocus
            name="title"
            placeholder="일정 제목"
            required
          />
        </label>

        <input name="start_date" readOnly type="hidden" value={range.start} />
        <input name="end_date" readOnly type="hidden" value={range.end} />
        <input
          name="start_time"
          readOnly
          type="hidden"
          value={hasTime ? startTime : ""}
        />
        <input
          name="end_time"
          readOnly
          type="hidden"
          value={hasTime ? endTime : ""}
        />
        <input name="custom_color" readOnly type="hidden" value={color} />

        <button
          className="event-setting-row event-date-setting"
          onClick={() => {
            blurActiveInput();
            setIsDatePickerOpen(true);
          }}
          type="button"
        >
          <span className="event-setting-icon" aria-hidden="true">
            31
          </span>
          <span>
            <small>날짜</small>
            <strong>{formatEventDateSummary(range)}</strong>
          </span>
          <span className="event-setting-chevron" aria-hidden="true">
            ›
          </span>
        </button>

        <div className="event-time-section">
          <button
            aria-checked={hasTime}
            className="event-setting-row"
            onClick={toggleTime}
            role="switch"
            type="button"
          >
            <span className="event-setting-icon" aria-hidden="true">
              ◷
            </span>
            <span>
              <small>시간</small>
              <strong>
                {hasTime ? `${startTime} – ${endTime}` : "시간 설정"}
              </strong>
            </span>
            <span
              aria-hidden="true"
              className={`event-time-switch${hasTime ? " is-on" : ""}`}
            >
              <span />
            </span>
          </button>

          {hasTime ? (
            <div className="event-time-fields">
              <label className="field">
                <span>시작</span>
                <input
                  onChange={(event) => {
                    const nextStart = event.target.value;
                    setStartTime(nextStart);
                    if (
                      range.start === range.end &&
                      nextStart >= endTime
                    ) {
                      setEndTime(addOneHour(nextStart));
                    }
                  }}
                  type="time"
                  value={startTime}
                />
              </label>
              <label className="field">
                <span>종료</span>
                <input
                  min={range.start === range.end ? startTime : undefined}
                  onChange={(event) => setEndTime(event.target.value)}
                  type="time"
                  value={endTime}
                />
              </label>
            </div>
          ) : null}
        </div>

        <div className="event-color-summary">
          <button
            aria-label={`컬러 선택, 현재 ${selectedColorName}`}
            className="event-color-trigger"
            onClick={() => {
              blurActiveInput();
              setIsColorPickerOpen(true);
            }}
            style={{
              backgroundColor: color || baseColor,
              color: color ? "#25302a" : "var(--ink)",
            }}
            type="button"
          >
            컬러
          </button>
        </div>

        <button
          className="button button--primary button--full event-submit"
          type="submit"
        >
          일정 저장
        </button>
      </form>

      {isDatePickerOpen ? (
        <EventDateRangePicker
          onApply={(nextRange) => {
            setRange(nextRange);
            setIsDatePickerOpen(false);
          }}
          onClose={() => setIsDatePickerOpen(false)}
          value={range}
        />
      ) : null}
      {isColorPickerOpen ? (
        <EventColorPicker
          defaultColor={baseColor}
          onClose={() => setIsColorPickerOpen(false)}
          onSelect={setColor}
          value={color}
        />
      ) : null}
    </>
  );
}

function EmptyState({
  icon,
  title,
  action,
  onAction,
}: {
  icon: string;
  title: string;
  action: string;
  onAction: () => void;
}) {
  return (
    <div className="empty-state">
      <span aria-hidden="true">{icon}</span>
      <p>{title}</p>
      <button className="button button--soft" onClick={onAction} type="button">
        {action}
      </button>
    </div>
  );
}

function AuthorBadge({ user }: { user: UserCode }) {
  return (
    <span className={`author-badge author-badge--${user}`}>
      {USER_META[user].name}
    </span>
  );
}

function CalendarDaySheet({
  date,
  events,
  daysOff,
  holidays,
  onAddDayOff,
  onAddEvent,
  onClose,
  onDeleteDayOff,
  onDeleteEvent,
}: {
  date: string;
  events: CalendarEvent[];
  daysOff: DayOff[];
  holidays: PublicHoliday[];
  onAddDayOff: () => void;
  onAddEvent: () => void;
  onClose: () => void;
  onDeleteDayOff: (item: DayOff) => void;
  onDeleteEvent: (event: CalendarEvent) => void;
}) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [onClose]);

  const isEmpty = !events.length && !daysOff.length && !holidays.length;

  return (
    <div
      className="day-sheet-backdrop"
      onMouseDown={onClose}
      role="presentation"
    >
      <section
        aria-labelledby="day-sheet-title"
        aria-modal="true"
        className="day-sheet"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="day-sheet-handle" aria-hidden="true" />
        <header className="day-sheet-head">
          <div>
            <h2 id="day-sheet-title">{formatKoreanDate(date, true)}</h2>
          </div>
          <button
            aria-label="날짜 상세 닫기"
            className="icon-button"
            onClick={onClose}
            type="button"
          >
            ×
          </button>
        </header>

        <div className="day-sheet-actions">
          <button
            className="button button--soft"
            onClick={() => {
              onClose();
              onAddDayOff();
            }}
            type="button"
          >
            휴무
          </button>
          <button
            className="button button--primary"
            onClick={() => {
              onClose();
              onAddEvent();
            }}
            type="button"
          >
            + 일정 추가
          </button>
        </div>

        <div className="day-sheet-content">
          {daysOff.length ? (
            <div className="dayoff-list">
              {daysOff.map((item) => (
                <div
                  className={`dayoff-row dayoff-row--${item.owner_id}`}
                  key={item.id}
                >
                  <AuthorBadge user={item.owner_id} />
                  <strong>{item.day_off_type}</strong>
                  <button
                    aria-label={`${USER_META[item.owner_id].name} 휴무 삭제`}
                    className="row-delete"
                    onClick={() => onDeleteDayOff(item)}
                    type="button"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          {holidays.length ? (
            <div className="holiday-detail-list">
              {holidays.map((holiday) => (
                <div className="holiday-detail" key={holiday.date}>
                  <span>공휴일</span>
                  <strong>{holiday.name}</strong>
                </div>
              ))}
            </div>
          ) : null}

          {events.length ? (
            <div className="detail-list">
              {events.map((event) => (
                <article className="detail-row" key={event.id}>
                  {event.event_type === "anniversary" ? (
                    <span className="detail-emoji">
                      {anniversaryEmoji(event.title)}
                    </span>
                  ) : (
                    <span
                      className={`detail-dot detail-dot--${calendarEventColor(event)}`}
                      style={
                        event.custom_color
                          ? { backgroundColor: event.custom_color }
                          : undefined
                      }
                    />
                  )}
                  <div className="detail-row-copy">
                    <strong>{event.title}</strong>
                    <p>
                      {event.is_all_day
                        ? "종일"
                        : event.end_at
                          ? `${timeInSeoul(event.start_at)}–${timeInSeoul(event.end_at)}`
                          : `${timeInSeoul(event.start_at)} 시작`}
                      {eventDateRange(event).start !==
                      eventDateRange(event).end
                        ? ` · ${formatKoreanDate(eventDateRange(event).start)}–${formatKoreanDate(eventDateRange(event).end)}`
                        : ""}
                      {" · "}
                      {event.event_type === "anniversary"
                        ? "기념일"
                        : calendarEventScope(event) === "shared"
                          ? "공통일정"
                          : calendarEventScope(event) === "personal"
                            ? `${USER_META[event.author_id as UserCode].name} 개인일정`
                            : "나만보기"}
                    </p>
                  </div>
                  {event.event_type !== "anniversary" ? (
                    <button
                      aria-label={`${event.title} 일정 삭제`}
                      className="row-delete"
                      onClick={() => onDeleteEvent(event)}
                      type="button"
                    >
                      ×
                    </button>
                  ) : null}
                </article>
              ))}
            </div>
          ) : null}

          {isEmpty ? (
            <div className="day-sheet-empty">
              <span aria-hidden="true">◷</span>
              <p>이 날짜에는 일정이 없어요</p>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function CalendarView({
  events,
  daysOff,
  holidays,
  selectedDate,
  setSelectedDate,
  onAddEvent,
  onAddDayOff,
  onDeleteEvent,
  onDeleteDayOff,
  onVisibleYearChange,
}: {
  events: CalendarEvent[];
  daysOff: DayOff[];
  holidays: PublicHoliday[];
  selectedDate: string;
  setSelectedDate: (date: string) => void;
  onAddEvent: (range?: DateRange) => void;
  onAddDayOff: () => void;
  onDeleteEvent: (event: CalendarEvent) => void;
  onDeleteDayOff: (item: DayOff) => void;
  onVisibleYearChange: (year: number) => void;
}) {
  const selected = parseDateKey(selectedDate);
  const [visibleMonth, setVisibleMonth] = useState(
    new Date(selected.getFullYear(), selected.getMonth(), 1),
  );
  const [monthMotion, setMonthMotion] = useState<"next" | "previous" | null>(
    null,
  );
  const [isDaySheetOpen, setIsDaySheetOpen] = useState(false);
  const gestureRef = useRef<{
    startX: number;
    startY: number;
    pointerId: number;
  } | null>(null);
  const suppressClickRef = useRef(false);

  const systemEvents = useMemo<CalendarEvent[]>(() => {
    const year = visibleMonth.getFullYear();
    return [
      ["04-15", "대호 생일"],
      ["05-06", "상희 생일"],
      ["08-30", "결혼기념일"],
      ["11-17", "만난 날 기념일"],
    ].map(([day, title]) => ({
      id: `system-${year}-${day}`,
      title,
      start_at: `${year}-${day}T00:00:00+09:00`,
      is_all_day: true,
      visibility: "shared" as const,
      author_id: "system" as const,
      event_type: "anniversary" as const,
    }));
  }, [visibleMonth]);

  const allEvents = useMemo(
    () => [...events, ...systemEvents],
    [events, systemEvents],
  );
  const year = visibleMonth.getFullYear();
  const month = visibleMonth.getMonth();
  const days = useMemo(() => {
    const firstWeekday = new Date(year, month, 1).getDay();
    const firstCell = new Date(year, month, 1 - firstWeekday, 12);
    return Array.from({ length: 42 }, (_, index) => {
      const date = new Date(firstCell);
      date.setDate(firstCell.getDate() + index);
      return date;
    });
  }, [month, year]);
  const eventLanes = useMemo(
    () => buildCalendarEventLanes(allEvents, days),
    [allEvents, days],
  );
  const holidayWeekIndexes = useMemo(() => {
    const dayIndexes = new Map(
      days.map((date, index) => [toDateKey(date), index]),
    );
    const indexes = new Set<number>();
    holidays.forEach((holiday) => {
      if (!holiday.is_holiday) return;
      const dayIndex = dayIndexes.get(holiday.date);
      if (dayIndex !== undefined) indexes.add(Math.floor(dayIndex / 7));
    });
    return indexes;
  }, [days, holidays]);

  const selectedEvents = allEvents.filter((event) =>
    eventCoversDate(event, selectedDate),
  );
  const selectedDaysOff = daysOff.filter((item) => item.date === selectedDate);
  const selectedHolidays = holidays.filter(
    (item) => item.is_holiday && item.date === selectedDate,
  );

  useEffect(() => {
    onVisibleYearChange(visibleMonth.getFullYear());
  }, [onVisibleYearChange, visibleMonth]);

  function moveMonth(offset: number) {
    const next = new Date(year, month + offset, 1);
    setMonthMotion(offset > 0 ? "next" : "previous");
    setVisibleMonth(next);
    setSelectedDate(toDateKey(next));
  }

  function startGesture(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    const target = (event.target as Element | null)?.closest<HTMLElement>(
      "[data-calendar-date]",
    );
    if (!target) return;

    gestureRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      pointerId: event.pointerId,
    };
  }

  function finishGesture(event: ReactPointerEvent<HTMLDivElement>) {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;

    const deltaX = event.clientX - gesture.startX;
    const deltaY = event.clientY - gesture.startY;
    if (
      Math.abs(deltaX) >= 56 &&
      Math.abs(deltaX) > Math.abs(deltaY) * 1.2
    ) {
      suppressClickRef.current = true;
      moveMonth(deltaX < 0 ? 1 : -1);
    }

    gestureRef.current = null;
    globalThis.setTimeout(() => {
      suppressClickRef.current = false;
    }, 0);
  }

  function cancelGesture() {
    gestureRef.current = null;
  }

  return (
    <div className="calendar-layout">
      <section className="card calendar-card">
        <div className="calendar-toolbar">
          <button
            aria-label="이전 달"
            className="icon-button"
            onClick={() => moveMonth(-1)}
            type="button"
          >
            ‹
          </button>
          <button
            aria-label="이번 달에서 오늘로 이동"
            className="month-title"
            onClick={() => {
              const today = new Date();
              const todayMonth = new Date(
                today.getFullYear(),
                today.getMonth(),
                1,
              );
              if (todayMonth.getTime() !== visibleMonth.getTime()) {
                setMonthMotion(
                  todayMonth > visibleMonth ? "next" : "previous",
                );
                setVisibleMonth(todayMonth);
              }
              setSelectedDate(toDateKey(today));
            }}
            type="button"
          >
            <strong>
              {year}년 {month + 1}월
            </strong>
          </button>
          <button
            aria-label="다음 달"
            className="icon-button"
            onClick={() => moveMonth(1)}
            type="button"
          >
            ›
          </button>
        </div>
        <div className="calendar-weekdays" aria-hidden="true">
          {["일", "월", "화", "수", "목", "금", "토"].map((day) => (
            <span key={day}>{day}</span>
          ))}
        </div>
        <div
          className={`calendar-grid${
            monthMotion ? ` calendar-grid--slide-${monthMotion}` : ""
          }`}
          key={`${year}-${month}`}
          onPointerCancel={cancelGesture}
          onPointerDown={startGesture}
          onPointerUp={finishGesture}
        >
          {days.map((date, dayIndex) => {
            const key = toDateKey(date);
            const weekIndex = Math.floor(dayIndex / 7);
            const weekHasHoliday = holidayWeekIndexes.has(weekIndex);
            const dateEvents = allEvents
              .filter(
                (event) =>
                  event.event_type !== "anniversary" &&
                  eventCoversDate(event, key),
              )
              .map((event) => ({
                event,
                lane:
                  eventLanes.get(
                    calendarEventLaneKey(weekIndex, event.id),
                  ) ?? 0,
              }))
              .sort(
                (left, right) =>
                  left.lane - right.lane ||
                  left.event.start_at.localeCompare(right.event.start_at),
              );
            const hiddenEventCount = dateEvents.filter(
              ({ lane }) => lane >= 3,
            ).length;
            const dateAnniversaries = systemEvents.filter(
              (event) => eventCoversDate(event, key),
            );
            const dateHolidays = holidays.filter(
              (holiday) => holiday.is_holiday && holiday.date === key,
            );
            const dateDaysOff = daysOff.filter((item) => item.date === key);
            const owners = new Set(dateDaysOff.map((item) => item.owner_id));
            const background =
              owners.size === 2
                ? "linear-gradient(135deg, rgba(127,169,155,.16) 0 50%, rgba(233,166,173,.16) 50%)"
                : owners.has("daeho")
                  ? "rgba(127,169,155,.15)"
                  : owners.has("sanghee")
                    ? "rgba(233,166,173,.15)"
                    : undefined;
            const isOutside = date.getMonth() !== month;
            const isToday = key === toDateKey(new Date());
            return (
              <button
                aria-label={`${formatKoreanDate(key, true)}${
                  dateEvents.length
                    ? `, 일정 ${dateEvents.length}개`
                    : dateHolidays.length
                      ? `, ${dateHolidays.map((item) => item.name).join(", ")}`
                      : ""
                }`}
                className={[
                  "calendar-day",
                  isOutside ? "calendar-day--outside" : "",
                  isToday ? "calendar-day--today" : "",
                  dateHolidays.length ? "calendar-day--holiday" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                data-calendar-date={key}
                key={key}
                onClick={() => {
                  if (suppressClickRef.current) return;
                  setSelectedDate(key);
                  setIsDaySheetOpen(true);
                }}
                style={{ background }}
                type="button"
              >
                <span className="day-heading">
                  <span className="day-number">{date.getDate()}</span>
                  {dateAnniversaries.length ? (
                    <span className="anniversary-icons">
                      {dateAnniversaries.map((event) => (
                        <span key={event.id} title={event.title}>
                          {anniversaryEmoji(event.title)}
                        </span>
                      ))}
                    </span>
                  ) : null}
                </span>
                {weekHasHoliday ? (
                  <span
                    aria-hidden={!dateHolidays.length}
                    className={`holiday-label${
                      dateHolidays.length ? "" : " holiday-label--empty"
                    }`}
                  >
                    {dateHolidays.length
                      ? dateHolidays.map((holiday) => holiday.name).join(" · ")
                      : "\u00a0"}
                  </span>
                ) : null}
                <span className="day-events">
                  {dateEvents
                    .filter(({ lane }) => lane < 3)
                    .map(({ event, lane }) => {
                      const range = eventDateRange(event);
                      const isRange = range.start !== range.end;
                      const isSegmentStart =
                        isRange &&
                        (range.start === key || date.getDay() === 0);
                      const isSegmentEnd =
                        isRange && (range.end === key || date.getDay() === 6);
                      const showTitle = !isRange || isSegmentStart;
                      const showStartTime =
                        showTitle &&
                        !event.is_all_day &&
                        range.start === key;

                      return (
                        <span
                          className={[
                            "event-chip",
                            `event-chip--${calendarEventColor(event)}`,
                            isRange ? "event-chip--range" : "",
                            isSegmentStart
                              ? "event-chip--segment-start"
                              : "",
                            isSegmentEnd ? "event-chip--segment-end" : "",
                          ]
                            .filter(Boolean)
                            .join(" ")}
                          key={event.id}
                          style={{
                            gridRow: lane + 1,
                            ...(event.custom_color
                              ? {
                                  backgroundColor: event.custom_color,
                                  color: "#25302a",
                                }
                              : {}),
                          }}
                        >
                          {showTitle ? (
                            <>
                              {showStartTime
                                ? `${timeInSeoul(event.start_at)} `
                                : ""}
                              {event.title}
                            </>
                          ) : (
                            "\u00a0"
                          )}
                        </span>
                      );
                    })}
                  {hiddenEventCount ? (
                    <span className="more-events">+{hiddenEventCount}</span>
                  ) : null}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {isDaySheetOpen ? (
        <CalendarDaySheet
          date={selectedDate}
          daysOff={selectedDaysOff}
          events={selectedEvents}
          holidays={selectedHolidays}
          onAddDayOff={onAddDayOff}
          onAddEvent={onAddEvent}
          onClose={() => setIsDaySheetOpen(false)}
          onDeleteDayOff={onDeleteDayOff}
          onDeleteEvent={onDeleteEvent}
        />
      ) : null}
    </div>
  );
}

function TodoView({
  todos,
  currentUser,
  onCreate,
  onToggle,
  onDelete,
}: {
  todos: Todo[];
  currentUser: UserCode;
  onCreate: (title: string, visibility: Visibility, dueAt?: string) => void;
  onToggle: (item: Todo) => void;
  onDelete: (item: Todo) => void;
}) {
  const [title, setTitle] = useState("");
  const [visibility, setVisibility] = useState<Visibility>("shared");
  const [dueAt, setDueAt] = useState("");
  const active = todos.filter((item) => !item.is_completed);
  const completed = todos.filter((item) => item.is_completed);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim()) return;
    onCreate(title.trim(), visibility, dueAt || undefined);
    setTitle("");
    setDueAt("");
  }

  return (
    <section className="feature-grid">
      <div className="card quick-form-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">빠른 추가</p>
            <h2>할 일을 적어 주세요</h2>
          </div>
          <AuthorBadge user={currentUser} />
        </div>
        <form className="quick-form" onSubmit={submit}>
          <label className="field field--grow">
            <span className="sr-only">할 일 제목</span>
            <input
              onChange={(event) => setTitle(event.target.value)}
              placeholder="예: 관리비 납부하기"
              value={title}
            />
          </label>
          <button
            className="button button--primary"
            disabled={!title.trim()}
            type="submit"
          >
            추가
          </button>
          <div className="quick-form-options">
            <label className="mini-field">
              <span>공개 범위</span>
              <select
                onChange={(event) =>
                  setVisibility(event.target.value as Visibility)
                }
                value={visibility}
              >
                <option value="shared">공동</option>
                <option value="private">개인</option>
              </select>
            </label>
            <label className="mini-field">
              <span>마감일</span>
              <input
                min={toDateKey(new Date())}
                onChange={(event) => setDueAt(event.target.value)}
                type="date"
                value={dueAt}
              />
            </label>
          </div>
        </form>
      </div>

      <div className="card list-card">
        <div className="list-title">
          <h2>해야 할 일</h2>
          <span>{active.length}</span>
        </div>
        {active.length ? (
          <div className="check-list">
            {active.map((item) => (
              <button
                className="check-row"
                key={item.id}
                onClick={() => onToggle(item)}
                type="button"
              >
                <span className="round-check" aria-hidden="true" />
                <span className="check-copy">
                  <strong>{item.title}</strong>
                  <small>
                    {item.due_at
                      ? `${formatKoreanDate(item.due_at)}까지 · `
                      : ""}
                    {item.visibility === "shared" ? "공동" : "개인"} ·{" "}
                    {USER_META[item.author_id].name}
                  </small>
                </span>
                <span
                  aria-label="삭제"
                  className="row-delete"
                  onClick={(event) => {
                    event.stopPropagation();
                    onDelete(item);
                  }}
                  role="button"
                  tabIndex={0}
                >
                  ×
                </span>
              </button>
            ))}
          </div>
        ) : (
          <EmptyState
            action="위에서 추가하기"
            icon="✓"
            onAction={() =>
              document.querySelector<HTMLInputElement>(".quick-form input")?.focus()
            }
            title="아직 할 일이 없어요"
          />
        )}
      </div>

      {completed.length ? (
        <details className="card completed-card">
          <summary>완료한 일 {completed.length}개</summary>
          <div className="check-list">
            {completed.map((item) => (
              <button
                className="check-row check-row--completed"
                key={item.id}
                onClick={() => onToggle(item)}
                type="button"
              >
                <span className="round-check">✓</span>
                <span className="check-copy">
                  <strong>{item.title}</strong>
                  <small>다시 열려면 눌러 주세요</small>
                </span>
              </button>
            ))}
          </div>
        </details>
      ) : null}
    </section>
  );
}

function ShoppingView({
  items,
  currentUser,
  onCreate,
  onToggle,
  onClearCompleted,
}: {
  items: ShoppingItem[];
  currentUser: UserCode;
  onCreate: (name: string) => void;
  onToggle: (item: ShoppingItem) => void;
  onClearCompleted: () => void;
}) {
  const [name, setName] = useState("");
  const active = items.filter((item) => !item.is_purchased);
  const completed = items.filter((item) => item.is_purchased);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) return;
    onCreate(name.trim());
    setName("");
  }

  return (
    <section className="feature-grid">
      <form className="card shopping-quick" onSubmit={submit}>
        <div>
          <p className="eyebrow">쇼핑목록</p>
          <h2>무엇을 사야 하나요?</h2>
        </div>
        <div className="inline-input">
          <input
            aria-label="쇼핑 품목"
            onChange={(event) => setName(event.target.value)}
            placeholder="품목명만 입력해도 돼요"
            value={name}
          />
          <button
            className="button button--primary"
            disabled={!name.trim()}
            type="submit"
          >
            추가
          </button>
        </div>
        <p className="form-note">
          {USER_META[currentUser].name} 이름으로 공동 목록에 추가됩니다.
        </p>
      </form>

      <div className="card list-card">
        <div className="list-title">
          <h2>살 것</h2>
          <span>{active.length}</span>
        </div>
        {active.length ? (
          <div className="check-list">
            {active.map((item) => (
              <button
                className="check-row shopping-row"
                key={item.id}
                onClick={() => onToggle(item)}
                type="button"
              >
                <span className="square-check" />
                <span className="check-copy">
                  <strong>{item.name}</strong>
                  <small>
                    {item.quantity}
                    {item.unit ?? "개"} · {item.category} ·{" "}
                    {USER_META[item.added_by].name} 추가
                  </small>
                </span>
              </button>
            ))}
          </div>
        ) : (
          <EmptyState
            action="품목 추가"
            icon="⌑"
            onAction={() =>
              document
                .querySelector<HTMLInputElement>(".shopping-quick input")
                ?.focus()
            }
            title="쇼핑목록이 비어 있습니다"
          />
        )}
      </div>

      {completed.length ? (
        <details className="card completed-card" open>
          <summary>
            <span>구매 완료 {completed.length}개</span>
            <button
              className="text-button text-button--danger"
              onClick={(event) => {
                event.preventDefault();
                onClearCompleted();
              }}
              type="button"
            >
              모두 지우기
            </button>
          </summary>
          <div className="check-list">
            {completed.map((item) => (
              <button
                className="check-row check-row--completed"
                key={item.id}
                onClick={() => onToggle(item)}
                type="button"
              >
                <span className="square-check">✓</span>
                <span className="check-copy">
                  <strong>{item.name}</strong>
                  <small>
                    {item.purchased_by
                      ? `${USER_META[item.purchased_by].name} 구매 완료`
                      : "구매 완료"}
                  </small>
                </span>
              </button>
            ))}
          </div>
        </details>
      ) : null}
    </section>
  );
}

const TRIP_SECTION_LABELS: Array<[TripSection, string]> = [
  ["overview", "개요"],
  ["trip_flights", "비행기"],
  ["trip_accommodations", "숙소"],
  ["trip_transportations", "교통"],
  ["trip_foods", "먹을 것"],
  ["trip_places", "갈 곳"],
];

function optionalFormValue(form: FormData, name: string) {
  const value = String(form.get(name) ?? "").trim();
  return value || null;
}

function priceFormValue(form: FormData) {
  const value = Number(form.get("price"));
  return Number.isFinite(value) && value > 0 ? value : null;
}

function TripDetailForm({
  trip,
  resource,
  item,
  onClose,
  onSubmit,
}: {
  trip: Trip;
  resource: TripDetailResource;
  item?: TripDetailItem;
  onClose: () => void;
  onSubmit: (
    resource: TripDetailResource,
    payload: Record<string, unknown>,
    id?: string,
  ) => void;
}) {
  const label =
    TRIP_SECTION_LABELS.find(([id]) => id === resource)?.[1] ?? "세부 정보";
  const flight = resource === "trip_flights" ? (item as TripFlight) : undefined;
  const accommodation =
    resource === "trip_accommodations"
      ? (item as TripAccommodation)
      : undefined;
  const transportation =
    resource === "trip_transportations"
      ? (item as TripTransportation)
      : undefined;
  const food = resource === "trip_foods" ? (item as TripFood) : undefined;
  const place = resource === "trip_places" ? (item as TripPlace) : undefined;
  const detailPrice =
    flight?.price ?? accommodation?.price ?? transportation?.price ?? null;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const base = { trip_id: trip.id };
    let payload: Record<string, unknown>;

    if (resource === "trip_flights") {
      payload = {
        ...base,
        direction: String(form.get("direction") ?? "가는 편"),
        departure_city: optionalFormValue(form, "departure_city"),
        departure_airport: optionalFormValue(form, "departure_airport"),
        departure_at: toSeoulTimestamp(
          String(form.get("departure_at") ?? ""),
        ),
        arrival_city: optionalFormValue(form, "arrival_city"),
        arrival_airport: optionalFormValue(form, "arrival_airport"),
        arrival_at: toSeoulTimestamp(String(form.get("arrival_at") ?? "")),
        airline: optionalFormValue(form, "airline"),
        flight_number: optionalFormValue(form, "flight_number"),
        reservation_number: optionalFormValue(form, "reservation_number"),
        seat_info: optionalFormValue(form, "seat_info"),
        baggage_info: optionalFormValue(form, "baggage_info"),
        price: priceFormValue(form),
        memo: optionalFormValue(form, "memo"),
      };
    } else if (resource === "trip_accommodations") {
      const name = optionalFormValue(form, "name");
      if (!name) return;
      payload = {
        ...base,
        name,
        address: optionalFormValue(form, "address"),
        map_url: optionalFormValue(form, "map_url"),
        check_in_at: toSeoulTimestamp(String(form.get("check_in_at") ?? "")),
        check_out_at: toSeoulTimestamp(
          String(form.get("check_out_at") ?? ""),
        ),
        reservation_number: optionalFormValue(form, "reservation_number"),
        price: priceFormValue(form),
        contact: optionalFormValue(form, "contact"),
        memo: optionalFormValue(form, "memo"),
      };
    } else if (resource === "trip_transportations") {
      const title = optionalFormValue(form, "title");
      if (!title) return;
      payload = {
        ...base,
        transport_type: String(form.get("transport_type") ?? "기차"),
        title,
        departure_location: optionalFormValue(form, "departure_location"),
        departure_at: toSeoulTimestamp(
          String(form.get("departure_at") ?? ""),
        ),
        arrival_location: optionalFormValue(form, "arrival_location"),
        arrival_at: toSeoulTimestamp(String(form.get("arrival_at") ?? "")),
        reservation_info: optionalFormValue(form, "reservation_info"),
        price: priceFormValue(form),
        link: optionalFormValue(form, "link"),
        memo: optionalFormValue(form, "memo"),
      };
    } else if (resource === "trip_foods") {
      const name = optionalFormValue(form, "name");
      if (!name) return;
      payload = {
        ...base,
        name,
        item_type: String(form.get("item_type") ?? "음식"),
        location: optionalFormValue(form, "location"),
        link: optionalFormValue(form, "link"),
        price_range: optionalFormValue(form, "price_range"),
        is_visited: food?.is_visited ?? false,
        memo: optionalFormValue(form, "memo"),
      };
    } else {
      const name = optionalFormValue(form, "name");
      if (!name) return;
      payload = {
        ...base,
        name,
        category: String(form.get("category") ?? "관광"),
        location: optionalFormValue(form, "location"),
        link: optionalFormValue(form, "link"),
        desired_date: optionalFormValue(form, "desired_date"),
        is_visited: place?.is_visited ?? false,
        memo: optionalFormValue(form, "memo"),
      };
    }

    onSubmit(resource, payload, item?.id);
    onClose();
  }

  return (
    <Modal onClose={onClose} title={`${label} ${item ? "수정" : "추가"}`}>
      <form className="modal-form" onSubmit={submit}>
        {resource === "trip_flights" ? (
          <>
            <div className="field-row">
              <label className="field">
                <span>구분</span>
                <select
                  defaultValue={flight?.direction ?? "가는 편"}
                  name="direction"
                >
                  <option>가는 편</option>
                  <option>오는 편</option>
                  <option>기타</option>
                </select>
              </label>
              <label className="field">
                <span>항공사</span>
                <input
                  autoFocus
                  defaultValue={flight?.airline ?? ""}
                  name="airline"
                  placeholder="예: 대한항공"
                />
              </label>
            </div>
            <div className="field-row">
              <label className="field">
                <span>출발 도시</span>
                <input
                  defaultValue={flight?.departure_city ?? ""}
                  name="departure_city"
                  placeholder="서울"
                />
              </label>
              <label className="field">
                <span>출발 공항</span>
                <input
                  defaultValue={flight?.departure_airport ?? ""}
                  name="departure_airport"
                  placeholder="인천 ICN"
                />
              </label>
            </div>
            <label className="field">
              <span>출발 일시</span>
              <input
                defaultValue={toDateTimeInput(flight?.departure_at)}
                name="departure_at"
                type="datetime-local"
              />
            </label>
            <div className="field-row">
              <label className="field">
                <span>도착 도시</span>
                <input
                  defaultValue={flight?.arrival_city ?? ""}
                  name="arrival_city"
                  placeholder="오사카"
                />
              </label>
              <label className="field">
                <span>도착 공항</span>
                <input
                  defaultValue={flight?.arrival_airport ?? ""}
                  name="arrival_airport"
                  placeholder="간사이 KIX"
                />
              </label>
            </div>
            <label className="field">
              <span>도착 일시</span>
              <input
                defaultValue={toDateTimeInput(flight?.arrival_at)}
                name="arrival_at"
                type="datetime-local"
              />
            </label>
            <div className="field-row">
              <label className="field">
                <span>편명</span>
                <input
                  defaultValue={flight?.flight_number ?? ""}
                  name="flight_number"
                  placeholder="KE721"
                />
              </label>
              <label className="field">
                <span>예약번호</span>
                <input
                  defaultValue={flight?.reservation_number ?? ""}
                  name="reservation_number"
                />
              </label>
            </div>
            <div className="field-row">
              <label className="field">
                <span>좌석</span>
                <input
                  defaultValue={flight?.seat_info ?? ""}
                  name="seat_info"
                  placeholder="12A, 12B"
                />
              </label>
              <label className="field">
                <span>수하물</span>
                <input
                  defaultValue={flight?.baggage_info ?? ""}
                  name="baggage_info"
                  placeholder="위탁 23kg"
                />
              </label>
            </div>
          </>
        ) : resource === "trip_accommodations" ? (
          <>
            <label className="field">
              <span>숙소 이름 *</span>
              <input
                autoFocus
                defaultValue={accommodation?.name ?? ""}
                name="name"
                required
              />
            </label>
            <label className="field">
              <span>주소</span>
              <input
                defaultValue={accommodation?.address ?? ""}
                name="address"
              />
            </label>
            <label className="field">
              <span>지도 링크</span>
              <input
                defaultValue={accommodation?.map_url ?? ""}
                inputMode="url"
                name="map_url"
                type="url"
              />
            </label>
            <div className="field-row">
              <label className="field">
                <span>체크인</span>
                <input
                  defaultValue={toDateTimeInput(accommodation?.check_in_at)}
                  name="check_in_at"
                  type="datetime-local"
                />
              </label>
              <label className="field">
                <span>체크아웃</span>
                <input
                  defaultValue={toDateTimeInput(accommodation?.check_out_at)}
                  name="check_out_at"
                  type="datetime-local"
                />
              </label>
            </div>
            <div className="field-row">
              <label className="field">
                <span>예약번호</span>
                <input
                  defaultValue={accommodation?.reservation_number ?? ""}
                  name="reservation_number"
                />
              </label>
              <label className="field">
                <span>연락처</span>
                <input
                  defaultValue={accommodation?.contact ?? ""}
                  inputMode="tel"
                  name="contact"
                />
              </label>
            </div>
          </>
        ) : resource === "trip_transportations" ? (
          <>
            <div className="field-row">
              <label className="field">
                <span>교통수단</span>
                <select
                  defaultValue={transportation?.transport_type ?? "기차"}
                  name="transport_type"
                >
                  {["기차", "버스", "렌터카", "택시", "선박", "기타"].map(
                    (option) => (
                      <option key={option}>{option}</option>
                    ),
                  )}
                </select>
              </label>
              <label className="field">
                <span>제목 *</span>
                <input
                  autoFocus
                  defaultValue={transportation?.title ?? ""}
                  name="title"
                  required
                />
              </label>
            </div>
            <div className="field-row">
              <label className="field">
                <span>출발 위치</span>
                <input
                  defaultValue={transportation?.departure_location ?? ""}
                  name="departure_location"
                />
              </label>
              <label className="field">
                <span>도착 위치</span>
                <input
                  defaultValue={transportation?.arrival_location ?? ""}
                  name="arrival_location"
                />
              </label>
            </div>
            <div className="field-row">
              <label className="field">
                <span>출발 일시</span>
                <input
                  defaultValue={toDateTimeInput(transportation?.departure_at)}
                  name="departure_at"
                  type="datetime-local"
                />
              </label>
              <label className="field">
                <span>도착 일시</span>
                <input
                  defaultValue={toDateTimeInput(transportation?.arrival_at)}
                  name="arrival_at"
                  type="datetime-local"
                />
              </label>
            </div>
            <label className="field">
              <span>예약 정보</span>
              <input
                defaultValue={transportation?.reservation_info ?? ""}
                name="reservation_info"
              />
            </label>
            <label className="field">
              <span>링크</span>
              <input
                defaultValue={transportation?.link ?? ""}
                inputMode="url"
                name="link"
                type="url"
              />
            </label>
          </>
        ) : resource === "trip_foods" ? (
          <>
            <div className="field-row">
              <label className="field">
                <span>이름 *</span>
                <input
                  autoFocus
                  defaultValue={food?.name ?? ""}
                  name="name"
                  required
                />
              </label>
              <label className="field">
                <span>종류</span>
                <select
                  defaultValue={food?.item_type ?? "음식"}
                  name="item_type"
                >
                  <option>음식</option>
                  <option>식당</option>
                </select>
              </label>
            </div>
            <label className="field">
              <span>위치</span>
              <input defaultValue={food?.location ?? ""} name="location" />
            </label>
            <div className="field-row">
              <label className="field">
                <span>가격대</span>
                <input
                  defaultValue={food?.price_range ?? ""}
                  name="price_range"
                  placeholder="예: 1인 2만원대"
                />
              </label>
              <label className="field">
                <span>링크</span>
                <input
                  defaultValue={food?.link ?? ""}
                  inputMode="url"
                  name="link"
                  type="url"
                />
              </label>
            </div>
          </>
        ) : (
          <>
            <div className="field-row">
              <label className="field">
                <span>장소 이름 *</span>
                <input
                  autoFocus
                  defaultValue={place?.name ?? ""}
                  name="name"
                  required
                />
              </label>
              <label className="field">
                <span>분류</span>
                <select
                  defaultValue={place?.category ?? "관광"}
                  name="category"
                >
                  <option>관광</option>
                  <option>쇼핑</option>
                  <option>체험</option>
                  <option>기타</option>
                </select>
              </label>
            </div>
            <label className="field">
              <span>위치</span>
              <input defaultValue={place?.location ?? ""} name="location" />
            </label>
            <div className="field-row">
              <label className="field">
                <span>방문 희망일</span>
                <input
                  max={trip.end_date}
                  min={trip.start_date}
                  defaultValue={place?.desired_date ?? ""}
                  name="desired_date"
                  type="date"
                />
              </label>
              <label className="field">
                <span>링크</span>
                <input
                  defaultValue={place?.link ?? ""}
                  inputMode="url"
                  name="link"
                  type="url"
                />
              </label>
            </div>
          </>
        )}

        {resource !== "trip_foods" && resource !== "trip_places" ? (
          <label className="field">
            <span>가격</span>
            <input
              defaultValue={detailPrice ?? ""}
              min="0"
              name="price"
              step="1"
              type="number"
            />
          </label>
        ) : null}
        <label className="field">
          <span>메모</span>
          <textarea defaultValue={item?.memo ?? ""} name="memo" rows={3} />
        </label>
        <button className="button button--primary button--full" type="submit">
          저장
        </button>
      </form>
    </Modal>
  );
}

function formatPrice(value?: number | null) {
  return value ? `${Number(value).toLocaleString("ko-KR")}원` : null;
}

function TravelDetailFields({
  fields,
}: {
  fields: Array<{
    label: string;
    value?: ReactNode;
    href?: string | null;
  }>;
}) {
  const visibleFields = fields.filter(
    (field) =>
      field.value !== null &&
      field.value !== undefined &&
      field.value !== "",
  );
  if (!visibleFields.length) return null;
  return (
    <dl className="travel-detail-fields">
      {visibleFields.map((field) => (
        <div key={field.label}>
          <dt>{field.label}</dt>
          <dd>
            {field.href ? (
              <a href={field.href} rel="noreferrer" target="_blank">
                {field.value}
              </a>
            ) : (
              field.value
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function TravelView({
  trips,
  flights,
  accommodations,
  transportations,
  foods,
  places,
  onAdd,
  onSaveDetail,
  onDeleteDetail,
  onDeleteTrip,
  onToggleVisited,
}: {
  trips: Trip[];
  flights: TripFlight[];
  accommodations: TripAccommodation[];
  transportations: TripTransportation[];
  foods: TripFood[];
  places: TripPlace[];
  onAdd: () => void;
  onSaveDetail: (
    resource: TripDetailResource,
    payload: Record<string, unknown>,
    id?: string,
  ) => void;
  onDeleteDetail: (resource: TripDetailResource, id: string) => void;
  onDeleteTrip: (trip: Trip) => void;
  onToggleVisited: (
    resource: "trip_foods" | "trip_places",
    id: string,
    isVisited: boolean,
  ) => void;
}) {
  const today = toDateKey(new Date());
  const upcoming = [...trips]
    .filter((trip) => trip.end_date >= today)
    .sort((a, b) => a.start_date.localeCompare(b.start_date));
  const past = [...trips]
    .filter((trip) => trip.end_date < today)
    .sort((a, b) => b.end_date.localeCompare(a.end_date));
  const [selectedTrip, setSelectedTrip] = useState<string | null>(
    upcoming[0]?.id ?? trips[0]?.id ?? null,
  );
  const [section, setSection] = useState<TripSection>("overview");
  const [editor, setEditor] = useState<{
    resource: TripDetailResource;
    item?: TripDetailItem;
  } | null>(null);
  const effectiveSelectedTrip = trips.some((trip) => trip.id === selectedTrip)
    ? selectedTrip
    : (upcoming[0]?.id ?? trips[0]?.id ?? null);
  const detail = trips.find((trip) => trip.id === effectiveSelectedTrip);

  const detailFlights = flights.filter((item) => item.trip_id === detail?.id);
  const detailAccommodations = accommodations.filter(
    (item) => item.trip_id === detail?.id,
  );
  const detailTransportations = transportations.filter(
    (item) => item.trip_id === detail?.id,
  );
  const detailFoods = foods.filter((item) => item.trip_id === detail?.id);
  const detailPlaces = places.filter((item) => item.trip_id === detail?.id);

  function deleteDetail(
    resource: TripDetailResource,
    id: string,
    title: string,
  ) {
    if (!globalThis.confirm(`"${title}" 항목을 삭제할까요?`)) return;
    onDeleteDetail(resource, id);
  }

  return (
    <section className="travel-layout">
      <div>
        <div className="page-lead">
          <div>
            <h2>여행</h2>
          </div>
          <button className="button button--primary" onClick={onAdd} type="button">
            + 여행 추가
          </button>
        </div>

        {upcoming.length ? (
          <div className="trip-list">
            {upcoming.map((trip, index) => {
              const inProgress =
                trip.start_date <= today && trip.end_date >= today;
              return (
                <button
                  className={`trip-card${effectiveSelectedTrip === trip.id ? " trip-card--selected" : ""}`}
                  key={trip.id}
                  onClick={() => {
                    setSelectedTrip(trip.id);
                    setSection("overview");
                  }}
                  style={{ animationDelay: `${index * 50}ms` }}
                  type="button"
                >
                  <div className="trip-visual">
                    <span>{trip.destination.includes("일본") ? "日本" : "여행"}</span>
                    <small>
                      {inProgress
                        ? "여행 중"
                        : daysUntil(trip.start_date) >= 0
                          ? `D-${daysUntil(trip.start_date)}`
                          : "예정"}
                    </small>
                  </div>
                  <div className="trip-copy">
                    <p>{trip.destination}</p>
                    <h3>{trip.title}</h3>
                    <span>
                      {formatKoreanDate(trip.start_date)} —{" "}
                      {formatKoreanDate(trip.end_date)}
                    </span>
                  </div>
                  <span aria-hidden="true">›</span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="card">
            <EmptyState
              action="여행 추가"
              icon="✈"
              onAction={onAdd}
              title="등록된 여행이 없습니다"
            />
          </div>
        )}

        {past.length ? (
          <details className="past-trips">
            <summary>지난 여행 {past.length}개</summary>
            <div className="trip-list trip-list--past">
              {past.map((trip) => (
                <button
                  className={`trip-card${effectiveSelectedTrip === trip.id ? " trip-card--selected" : ""}`}
                  key={trip.id}
                  onClick={() => {
                    setSelectedTrip(trip.id);
                    setSection("overview");
                  }}
                  type="button"
                >
                  <div className="trip-visual trip-visual--past">
                    <span>기록</span>
                  </div>
                  <div className="trip-copy">
                    <p>{trip.destination}</p>
                    <h3>{trip.title}</h3>
                    <span>{formatKoreanDate(trip.end_date)} 종료</span>
                  </div>
                  <span aria-hidden="true">›</span>
                </button>
              ))}
            </div>
          </details>
        ) : null}
      </div>

      {detail ? (
        <aside className="card trip-detail-card">
          <div className="trip-detail-title-row">
            <h2>{detail.title}</h2>
            <button
              className="text-button text-button--danger"
              onClick={() => onDeleteTrip(detail)}
              type="button"
            >
              여행 삭제
            </button>
          </div>
          <p className="trip-detail-period">
            {detail.destination} · {formatKoreanDate(detail.start_date, true)} —{" "}
            {formatKoreanDate(detail.end_date, true)}
          </p>
          <div className="trip-section-tabs" role="tablist" aria-label="여행 상세">
            {TRIP_SECTION_LABELS.map(([id, label]) => (
              <button
                aria-selected={section === id}
                className={section === id ? "is-active" : ""}
                key={id}
                onClick={() => setSection(id)}
                role="tab"
                type="button"
              >
                {label}
              </button>
            ))}
          </div>

          {section === "overview" ? (
            <div className="trip-overview">
              <div className="trip-overview-counts">
                <span>
                  <strong>{detailFlights.length}</strong> 비행기
                </span>
                <span>
                  <strong>{detailAccommodations.length}</strong> 숙소
                </span>
                <span>
                  <strong>
                    {detailTransportations.length +
                      detailFoods.length +
                      detailPlaces.length}
                  </strong>{" "}
                  기타 항목
                </span>
              </div>
              <div className="trip-memo">
                <span>메모</span>
                <p>{detail.memo || "등록된 메모가 없습니다."}</p>
                <small>{USER_META[detail.author_id].name} 작성</small>
              </div>
            </div>
          ) : (
            <div className="trip-detail-section">
              <div className="trip-detail-section-head">
                <strong>
                  {TRIP_SECTION_LABELS.find(([id]) => id === section)?.[1]}
                </strong>
                <button
                  className="button button--soft"
                  onClick={() => setEditor({ resource: section })}
                  type="button"
                >
                  + 추가
                </button>
              </div>

              {section === "trip_flights" ? (
                detailFlights.length ? (
                  <div className="travel-detail-list">
                    {detailFlights.map((item) => (
                      <article className="travel-detail-item" key={item.id}>
                        <div className="travel-detail-item-head">
                          <span className="travel-detail-icon">✈</span>
                          <div className="travel-detail-summary">
                            <small>
                              {item.direction}
                              {item.airline ? ` · ${item.airline}` : ""}
                              {item.flight_number
                                ? ` ${item.flight_number}`
                                : ""}
                            </small>
                            <strong>
                              {item.departure_city ||
                                item.departure_airport ||
                                "출발지 미정"}{" "}
                              →{" "}
                              {item.arrival_city ||
                                item.arrival_airport ||
                                "도착지 미정"}
                            </strong>
                          </div>
                          <div className="travel-detail-actions">
                            <button
                              aria-label="비행편 수정"
                              className="icon-button icon-button--small"
                              onClick={() =>
                                setEditor({
                                  resource: "trip_flights",
                                  item,
                                })
                              }
                              type="button"
                            >
                              ✎
                            </button>
                            <button
                              aria-label="비행편 삭제"
                              className="icon-button icon-button--small"
                              onClick={() =>
                                deleteDetail(
                                  "trip_flights",
                                  item.id,
                                  item.flight_number || "비행편",
                                )
                              }
                              type="button"
                            >
                              ×
                            </button>
                          </div>
                        </div>
                        <TravelDetailFields
                          fields={[
                            { label: "항공사", value: item.airline },
                            { label: "편명", value: item.flight_number },
                            { label: "출발 도시", value: item.departure_city },
                            { label: "출발 공항", value: item.departure_airport },
                            {
                              label: "출발 일시",
                              value: item.departure_at
                                ? formatDateTime(item.departure_at)
                                : null,
                            },
                            { label: "도착 도시", value: item.arrival_city },
                            { label: "도착 공항", value: item.arrival_airport },
                            {
                              label: "도착 일시",
                              value: item.arrival_at
                                ? formatDateTime(item.arrival_at)
                                : null,
                            },
                            {
                              label: "예약번호",
                              value: item.reservation_number,
                            },
                            { label: "좌석", value: item.seat_info },
                            { label: "수하물", value: item.baggage_info },
                            { label: "가격", value: formatPrice(item.price) },
                            { label: "메모", value: item.memo },
                          ]}
                        />
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="trip-empty-copy">등록된 비행편이 없습니다.</p>
                )
              ) : section === "trip_accommodations" ? (
                detailAccommodations.length ? (
                  <div className="travel-detail-list">
                    {detailAccommodations.map((item) => (
                      <article className="travel-detail-item" key={item.id}>
                        <div className="travel-detail-item-head">
                          <span className="travel-detail-icon">⌂</span>
                          <div className="travel-detail-summary">
                            <small>숙소</small>
                            <strong>{item.name}</strong>
                          </div>
                          <div className="travel-detail-actions">
                            <button
                              aria-label="숙소 수정"
                              className="icon-button icon-button--small"
                              onClick={() =>
                                setEditor({
                                  resource: "trip_accommodations",
                                  item,
                                })
                              }
                              type="button"
                            >
                              ✎
                            </button>
                            <button
                              aria-label="숙소 삭제"
                              className="icon-button icon-button--small"
                              onClick={() =>
                                deleteDetail(
                                  "trip_accommodations",
                                  item.id,
                                  item.name,
                                )
                              }
                              type="button"
                            >
                              ×
                            </button>
                          </div>
                        </div>
                        <TravelDetailFields
                          fields={[
                            { label: "주소", value: item.address },
                            {
                              label: "지도",
                              value: item.map_url ? "지도 열기" : null,
                              href: item.map_url,
                            },
                            {
                              label: "체크인",
                              value: item.check_in_at
                                ? formatDateTime(item.check_in_at)
                                : null,
                            },
                            {
                              label: "체크아웃",
                              value: item.check_out_at
                                ? formatDateTime(item.check_out_at)
                                : null,
                            },
                            {
                              label: "예약번호",
                              value: item.reservation_number,
                            },
                            { label: "연락처", value: item.contact },
                            { label: "가격", value: formatPrice(item.price) },
                            { label: "메모", value: item.memo },
                          ]}
                        />
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="trip-empty-copy">등록된 숙소가 없습니다.</p>
                )
              ) : section === "trip_transportations" ? (
                detailTransportations.length ? (
                  <div className="travel-detail-list">
                    {detailTransportations.map((item) => (
                      <article className="travel-detail-item" key={item.id}>
                        <div className="travel-detail-item-head">
                          <span className="travel-detail-icon">↔</span>
                          <div className="travel-detail-summary">
                            <small>{item.transport_type}</small>
                            <strong>{item.title}</strong>
                          </div>
                          <div className="travel-detail-actions">
                            <button
                              aria-label="교통 정보 수정"
                              className="icon-button icon-button--small"
                              onClick={() =>
                                setEditor({
                                  resource: "trip_transportations",
                                  item,
                                })
                              }
                              type="button"
                            >
                              ✎
                            </button>
                            <button
                              aria-label="교통 정보 삭제"
                              className="icon-button icon-button--small"
                              onClick={() =>
                                deleteDetail(
                                  "trip_transportations",
                                  item.id,
                                  item.title,
                                )
                              }
                              type="button"
                            >
                              ×
                            </button>
                          </div>
                        </div>
                        <TravelDetailFields
                          fields={[
                            {
                              label: "출발 위치",
                              value: item.departure_location,
                            },
                            {
                              label: "출발 일시",
                              value: item.departure_at
                                ? formatDateTime(item.departure_at)
                                : null,
                            },
                            {
                              label: "도착 위치",
                              value: item.arrival_location,
                            },
                            {
                              label: "도착 일시",
                              value: item.arrival_at
                                ? formatDateTime(item.arrival_at)
                                : null,
                            },
                            {
                              label: "예약 정보",
                              value: item.reservation_info,
                            },
                            { label: "가격", value: formatPrice(item.price) },
                            {
                              label: "링크",
                              value: item.link ? "링크 열기" : null,
                              href: item.link,
                            },
                            { label: "메모", value: item.memo },
                          ]}
                        />
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="trip-empty-copy">등록된 교통 정보가 없습니다.</p>
                )
              ) : section === "trip_foods" ? (
                detailFoods.length ? (
                  <div className="travel-detail-list">
                    {detailFoods.map((item) => (
                      <article
                        className={`travel-detail-item${item.is_visited ? " is-complete" : ""}`}
                        key={item.id}
                      >
                        <div className="travel-detail-item-head">
                          <button
                            aria-label={`${item.name} 방문 완료`}
                            aria-pressed={item.is_visited}
                            className="travel-check"
                            onClick={() =>
                              onToggleVisited(
                                "trip_foods",
                                item.id,
                                !item.is_visited,
                              )
                            }
                            type="button"
                          >
                            {item.is_visited ? "✓" : ""}
                          </button>
                          <div className="travel-detail-summary">
                            <small>{item.item_type}</small>
                            <strong>{item.name}</strong>
                          </div>
                          <div className="travel-detail-actions">
                            <button
                              aria-label="먹을 것 수정"
                              className="icon-button icon-button--small"
                              onClick={() =>
                                setEditor({
                                  resource: "trip_foods",
                                  item,
                                })
                              }
                              type="button"
                            >
                              ✎
                            </button>
                            <button
                              aria-label="먹을 것 삭제"
                              className="icon-button icon-button--small"
                              onClick={() =>
                                deleteDetail("trip_foods", item.id, item.name)
                              }
                              type="button"
                            >
                              ×
                            </button>
                          </div>
                        </div>
                        <TravelDetailFields
                          fields={[
                            { label: "위치", value: item.location },
                            { label: "가격대", value: item.price_range },
                            {
                              label: "링크",
                              value: item.link ? "링크 열기" : null,
                              href: item.link,
                            },
                            {
                              label: "방문 여부",
                              value: item.is_visited ? "완료" : "미완료",
                            },
                            { label: "메모", value: item.memo },
                          ]}
                        />
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="trip-empty-copy">등록된 먹을 것이 없습니다.</p>
                )
              ) : detailPlaces.length ? (
                <div className="travel-detail-list">
                  {detailPlaces.map((item) => (
                    <article
                      className={`travel-detail-item${item.is_visited ? " is-complete" : ""}`}
                      key={item.id}
                    >
                      <div className="travel-detail-item-head">
                        <button
                          aria-label={`${item.name} 방문 완료`}
                          aria-pressed={item.is_visited}
                          className="travel-check"
                          onClick={() =>
                            onToggleVisited(
                              "trip_places",
                              item.id,
                              !item.is_visited,
                            )
                          }
                          type="button"
                        >
                          {item.is_visited ? "✓" : ""}
                        </button>
                        <div className="travel-detail-summary">
                          <small>{item.category}</small>
                          <strong>{item.name}</strong>
                        </div>
                        <div className="travel-detail-actions">
                          <button
                            aria-label="갈 곳 수정"
                            className="icon-button icon-button--small"
                            onClick={() =>
                              setEditor({
                                resource: "trip_places",
                                item,
                              })
                            }
                            type="button"
                          >
                            ✎
                          </button>
                          <button
                            aria-label="갈 곳 삭제"
                            className="icon-button icon-button--small"
                            onClick={() =>
                              deleteDetail("trip_places", item.id, item.name)
                            }
                            type="button"
                          >
                            ×
                          </button>
                        </div>
                      </div>
                      <TravelDetailFields
                        fields={[
                          { label: "위치", value: item.location },
                          {
                            label: "방문 희망일",
                            value: item.desired_date
                              ? formatKoreanDate(item.desired_date, true)
                              : null,
                          },
                          {
                            label: "링크",
                            value: item.link ? "링크 열기" : null,
                            href: item.link,
                          },
                          {
                            label: "방문 여부",
                            value: item.is_visited ? "완료" : "미완료",
                          },
                          { label: "메모", value: item.memo },
                        ]}
                      />
                    </article>
                  ))}
                </div>
              ) : (
                <p className="trip-empty-copy">등록된 장소가 없습니다.</p>
              )}
            </div>
          )}
        </aside>
      ) : null}

      {detail && editor ? (
        <TripDetailForm
          item={editor.item}
          onClose={() => setEditor(null)}
          onSubmit={onSaveDetail}
          resource={editor.resource}
          trip={detail}
        />
      ) : null}
    </section>
  );
}

function FridgeView({
  items,
  onAdd,
  onConsume,
  onEdit,
}: {
  items: FridgeItem[];
  onAdd: () => void;
  onConsume: (item: FridgeItem) => void;
  onEdit: (item: FridgeItem) => void;
}) {
  const sorted = [...items].sort((a, b) =>
    a.expiration_date.localeCompare(b.expiration_date),
  );
  const urgent = sorted.filter((item) => daysUntil(item.expiration_date) <= 3);

  return (
    <section>
      <div className="page-lead">
        <div>
          <p className="eyebrow">유통기한 먼저</p>
          <h2>먹을 때를 놓치지 않게</h2>
          <p>
            {urgent.length
              ? `3일 안에 확인할 아이템이 ${urgent.length}개 있어요.`
              : "급하게 확인할 아이템이 없어요."}
          </p>
        </div>
        <button className="button button--primary" onClick={onAdd} type="button">
          + 아이템 추가
        </button>
      </div>

      {sorted.length ? (
        <div className="fridge-grid">
          {sorted.map((item, index) => {
            const days = daysUntil(item.expiration_date);
            return (
              <article
                className={`card fridge-card${
                  days < 0
                    ? " fridge-card--expired"
                    : days <= 3
                      ? " fridge-card--urgent"
                      : ""
                }`}
                key={item.id}
                style={{ animationDelay: `${index * 45}ms` }}
              >
                <div className="fridge-card-head">
                  <span className="storage-pill">{item.storage_type}</span>
                  <div>
                    <strong className="expiry-badge">
                      {expiryLabel(item.expiration_date)}
                    </strong>
                    <button
                      aria-label={`${item.name} 편집`}
                      className="fridge-edit-button"
                      onClick={() => onEdit(item)}
                      type="button"
                    >
                      ✎
                    </button>
                  </div>
                </div>
                <h3>{item.name}</h3>
                <p>
                  {item.quantity}
                  {item.unit ?? "개"} · {formatKoreanDate(item.expiration_date)}
                  까지 · {item.category ?? "기타"}
                </p>
                <button
                  className="button button--soft button--full"
                  onClick={() => onConsume(item)}
                  type="button"
                >
                  다 먹었어요
                </button>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="card">
          <EmptyState
            action="아이템 추가"
            icon="□"
            onAction={onAdd}
            title="등록된 아이템이 없어요"
          />
        </div>
      )}
    </section>
  );
}

function ParkingView({
  record,
  currentUser,
  onSave,
}: {
  record: ParkingRecord | null;
  currentUser: UserCode;
  onSave: (next: ParkingRecord) => void;
}) {
  const [floor, setFloor] = useState<ParkingRecord["floor"]>(
    record?.floor ?? "B5",
  );
  const [letter, setLetter] = useState<ParkingRecord["pillar_letter"]>(
    record?.pillar_letter ?? "C",
  );
  const [number, setNumber] = useState<ParkingRecord["pillar_number"]>(
    record?.pillar_number ?? 4,
  );
  const [isSaving, setIsSaving] = useState(false);

  async function save() {
    setIsSaving(true);
    onSave({
      id: newId(),
      floor,
      pillar_letter: letter,
      pillar_number: number,
      author_id: currentUser,
      created_at: new Date().toISOString(),
    });
    globalThis.setTimeout(() => setIsSaving(false), 350);
  }

  return (
    <section className="parking-layout">
      <article className="parking-current-card">
        <div>
          <p>현재 주차 위치</p>
          {record ? (
            <>
              <h2>
                {record.floor} <span>{record.pillar_letter}</span>
                {record.pillar_number}
              </h2>
              <div className="parking-meta">
                <AuthorBadge user={record.author_id} />
                <span>마지막 수정 {formatDateTime(record.created_at)}</span>
              </div>
            </>
          ) : (
            <>
              <h2 className="parking-empty">아직 저장 전</h2>
            </>
          )}
        </div>
        <div className="parking-mark" aria-hidden="true">
          P
          <span>●</span>
        </div>
      </article>

      <div className="card parking-picker">
        <div className="picker-group">
          <div className="picker-label">
            <strong>층</strong>
          </div>
          <div className="choice-grid choice-grid--three">
            {(["B4", "B5", "B6"] as const).map((value) => (
              <button
                aria-pressed={floor === value}
                className={floor === value ? "is-selected" : ""}
                key={value}
                onClick={() => setFloor(value)}
                type="button"
              >
                {value}
              </button>
            ))}
          </div>
        </div>
        <div className="picker-group">
          <div className="picker-label">
            <strong>기둥</strong>
          </div>
          <div className="pillar-pickers">
            <div className="choice-grid choice-grid--four">
              {(["A", "B", "C", "D"] as const).map((value) => (
                <button
                  aria-label={`기둥 ${value}`}
                  aria-pressed={letter === value}
                  className={letter === value ? "is-selected" : ""}
                  key={value}
                  onClick={() => setLetter(value)}
                  type="button"
                >
                  {value}
                </button>
              ))}
            </div>
            <div className="choice-grid choice-grid--four">
              {([1, 2, 3, 4] as const).map((value) => (
                <button
                  aria-label={`기둥 ${value}`}
                  aria-pressed={number === value}
                  className={number === value ? "is-selected" : ""}
                  key={value}
                  onClick={() => setNumber(value)}
                  type="button"
                >
                  {value}
                </button>
              ))}
            </div>
          </div>
        </div>
        <button
          className="button button--parking button--full"
          disabled={isSaving}
          onClick={save}
          type="button"
        >
          {isSaving
            ? "저장 중…"
            : `${floor} ${letter}${number} 저장하기`}
        </button>
      </div>
    </section>
  );
}

function EtcView({
  candidates,
  currentUser,
  onAdd,
  onToggle,
  onDelete,
}: {
  candidates: RandomCandidate[];
  currentUser: UserCode;
  onAdd: (type: RandomCandidate["type"], name: string, category: string) => void;
  onToggle: (item: RandomCandidate) => void;
  onDelete: (item: RandomCandidate) => void;
}) {
  const [type, setType] = useState<RandomCandidate["type"]>("destination");
  const [name, setName] = useState("");
  const [category, setCategory] = useState("국내");
  const [result, setResult] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);
  const filtered = candidates.filter((item) => item.type === type);
  const active = filtered.filter((item) => item.is_active);

  function choose() {
    if (!active.length || choosing) return;
    setChoosing(true);
    setResult(null);
    globalThis.setTimeout(() => {
      const picked = active[Math.floor(Math.random() * active.length)];
      setResult(picked.name);
      setChoosing(false);
    }, 720);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) return;
    onAdd(type, name.trim(), category);
    setName("");
  }

  return (
    <section>
      <div className="etc-switch" role="tablist" aria-label="랜덤 선택 종류">
        <button
          aria-selected={type === "destination"}
          className={type === "destination" ? "is-active" : ""}
          onClick={() => {
            setType("destination");
            setCategory("국내");
            setResult(null);
          }}
          role="tab"
          type="button"
        >
          여행지 뽑기
        </button>
        <button
          aria-selected={type === "meal"}
          className={type === "meal" ? "is-active" : ""}
          onClick={() => {
            setType("meal");
            setCategory("한식");
            setResult(null);
          }}
          role="tab"
          type="button"
        >
          오늘 뭐 먹지?
        </button>
      </div>

      <div className="etc-layout">
        <div className="random-card">
          <p className="eyebrow">
            {type === "destination" ? "다음 여행은 어디로?" : "오늘의 한 끼"}
          </p>
          <div className={`random-result${choosing ? " is-choosing" : ""}`}>
            <span aria-hidden="true">{type === "destination" ? "✈" : "●"}</span>
            <h2>
              {choosing
                ? "두근두근…"
                : result ??
                  (type === "destination"
                    ? "여행지를 뽑아 볼까요?"
                    : "메뉴를 뽑아 볼까요?")}
            </h2>
            <p>활성 후보 {active.length}개 중에서 선택합니다.</p>
          </div>
          <button
            className="button button--random button--full"
            disabled={!active.length || choosing}
            onClick={choose}
            type="button"
          >
            {result ? "다시 뽑기" : "랜덤 선택"}
          </button>
        </div>

        <div className="card candidate-card">
          <div className="section-heading">
            <div>
              <p className="eyebrow">후보 관리</p>
              <h2>{type === "destination" ? "여행지 후보" : "메뉴 후보"}</h2>
            </div>
            <AuthorBadge user={currentUser} />
          </div>
          <form className="candidate-form" onSubmit={submit}>
            <input
              aria-label={type === "destination" ? "여행지 이름" : "메뉴 이름"}
              onChange={(event) => setName(event.target.value)}
              placeholder={
                type === "destination" ? "예: 삿포로" : "예: 쌀국수"
              }
              value={name}
            />
            <select
              aria-label="분류"
              onChange={(event) => setCategory(event.target.value)}
              value={category}
            >
              {(type === "destination"
                ? ["국내", "해외"]
                : ["한식", "중식", "일식", "양식", "배달", "외식", "기타"]
              ).map((option) => (
                <option key={option}>{option}</option>
              ))}
            </select>
            <button
              className="button button--primary"
              disabled={!name.trim()}
              type="submit"
            >
              추가
            </button>
          </form>
          {filtered.length ? (
            <div className="candidate-list">
              {filtered.map((item) => (
                <div
                  className={`candidate-row${item.is_active ? "" : " is-disabled"}`}
                  key={item.id}
                >
                  <button
                    aria-label={`${item.name} ${
                      item.is_active ? "후보에서 제외" : "후보에 포함"
                    }`}
                    aria-pressed={item.is_active}
                    className="candidate-toggle"
                    onClick={() => onToggle(item)}
                    type="button"
                  >
                    <span />
                  </button>
                  <div>
                    <strong>{item.name}</strong>
                    <small>{item.category ?? "기타"}</small>
                  </div>
                  <button
                    aria-label={`${item.name} 삭제`}
                    className="icon-button icon-button--small"
                    onClick={() => onDelete(item)}
                    type="button"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              action="위에서 후보 추가"
              icon="✦"
              onAction={() =>
                document
                  .querySelector<HTMLInputElement>(".candidate-form input")
                  ?.focus()
              }
              title="아직 후보가 없어요"
            />
          )}
        </div>
      </div>
    </section>
  );
}

function ThemeToggleButton({
  theme,
  onToggle,
}: {
  theme: ThemeMode;
  onToggle: () => void;
}) {
  const nextMode = theme === "dark" ? "라이트" : "다크";

  return (
    <button
      aria-label={`${nextMode} 모드로 전환`}
      className="theme-toggle-button"
      onClick={onToggle}
      title={`${nextMode} 모드로 전환`}
      type="button"
    >
      <span aria-hidden="true">{theme === "dark" ? "☀" : "☾"}</span>
    </button>
  );
}

export function OipApp({
  initialMainTab = "schedule",
}: {
  initialMainTab?: MainTab;
}) {
  const [theme, setTheme] = useState<ThemeMode>(() => {
    if (typeof document === "undefined") return "light";
    return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("oip.theme", theme);
    } catch {}
    const themeMeta = document.querySelector<HTMLMetaElement>(
      'meta[name="theme-color"]',
    );
    if (themeMeta) {
      themeMeta.content = theme === "dark" ? "#12161b" : "#f5f6f8";
    }
  }, [theme]);

  const toggleTheme = () =>
    setTheme((current) => (current === "dark" ? "light" : "dark"));

  const [authState, setAuthState] = useState<
    "checking" | "locked" | "selecting" | "ready"
  >("checking");
  const [currentUser, setCurrentUser] = useState<UserCode>("daeho");
  const [mainTab, setMainTab] = useState<MainTab>(initialMainTab);
  const [scheduleTab, setScheduleTab] = useState<ScheduleTab>("calendar");
  const [modal, setModal] = useState<ModalName>(null);
  const [selectedDate, setSelectedDate] = useState(toDateKey(new Date()));
  const [eventRange, setEventRange] = useState<DateRange>({
    start: toDateKey(new Date()),
    end: toDateKey(new Date()),
  });
  const [eventScope, setEventScope] =
    useState<CalendarEventScope>("personal");
  const [editingFridge, setEditingFridge] = useState<FridgeItem | null>(null);
  const [holidayYear, setHolidayYear] = useState(new Date().getFullYear());
  const [toast, setToast] = useState<string | null>(null);
  const [demoMode, setDemoMode] = useState(false);
  const [isDataLoading, setIsDataLoading] = useState(true);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [daysOff, setDaysOff] = useState<DayOff[]>([]);
  const [holidays, setHolidays] = useState<PublicHoliday[]>([]);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [shopping, setShopping] = useState<ShoppingItem[]>([]);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [tripFlights, setTripFlights] = useState<TripFlight[]>([]);
  const [tripAccommodations, setTripAccommodations] = useState<
    TripAccommodation[]
  >([]);
  const [tripTransportations, setTripTransportations] = useState<
    TripTransportation[]
  >([]);
  const [tripFoods, setTripFoods] = useState<TripFood[]>([]);
  const [tripPlaces, setTripPlaces] = useState<TripPlace[]>([]);
  const [fridge, setFridge] = useState<FridgeItem[]>([]);
  const [parking, setParking] = useState<ParkingRecord | null>(null);
  const [candidates, setCandidates] = useState<RandomCandidate[]>([]);
  const loadedHolidayYears = useRef(new Set<number>());

  useEffect(() => {
    const targetPath = mainTab === "parking" ? "/parking" : "/";
    if (window.location.pathname === targetPath) return;
    window.history.replaceState(
      { ...window.history.state, oipMainTab: mainTab },
      "",
      targetPath,
    );
  }, [mainTab]);

  const showToast = useCallback((message: string) => {
    setToast(message);
    globalThis.setTimeout(() => setToast(null), 2600);
  }, []);

  useEffect(() => {
    let active = true;
    fetch("/api/auth")
      .then((response) => response.json())
      .then((data: { authenticated?: boolean }) => {
        if (!active) return;
        if (!data.authenticated) {
          setAuthState("locked");
          return;
        }
        const stored = localStorage.getItem("oip.currentUser");
        if (stored === "daeho" || stored === "sanghee") {
          setCurrentUser(stored);
          setAuthState("ready");
        } else {
          setAuthState("selecting");
        }
      })
      .catch(() => {
        if (active) setAuthState("locked");
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (authState !== "ready") return;
    let active = true;
    const resources = [
      "calendar_events",
      "calendar_days_off",
      "todos",
      "shopping_items",
      "trips",
      "trip_flights",
      "trip_accommodations",
      "trip_transportations",
      "trip_foods",
      "trip_places",
      "fridge_items",
      "parking_records",
      "random_candidates",
    ] as const;

    Promise.all(
      resources.map(async (resource) => {
        const response = await fetch(
          `/api/records?resource=${resource}&user=${currentUser}`,
        );
        if (!response.ok) {
          const error = (await response.json().catch(() => ({}))) as {
            code?: string;
          };
          if (error.code === "SUPABASE_NOT_CONFIGURED") {
            throw new Error("SUPABASE_NOT_CONFIGURED");
          }
          throw new Error("LOAD_FAILED");
        }
        return [resource, await response.json()] as const;
      }),
    )
      .then((entries) => {
        if (!active) return;
        const loaded = Object.fromEntries(entries) as Record<string, unknown>;
        setEvents((loaded.calendar_events as CalendarEvent[]) ?? []);
        setDaysOff((loaded.calendar_days_off as DayOff[]) ?? []);
        setTodos((loaded.todos as Todo[]) ?? []);
        setShopping((loaded.shopping_items as ShoppingItem[]) ?? []);
        setTrips((loaded.trips as Trip[]) ?? []);
        setTripFlights((loaded.trip_flights as TripFlight[]) ?? []);
        setTripAccommodations(
          (loaded.trip_accommodations as TripAccommodation[]) ?? [],
        );
        setTripTransportations(
          (loaded.trip_transportations as TripTransportation[]) ?? [],
        );
        setTripFoods((loaded.trip_foods as TripFood[]) ?? []);
        setTripPlaces((loaded.trip_places as TripPlace[]) ?? []);
        setFridge((loaded.fridge_items as FridgeItem[]) ?? []);
        setParking(
          ((loaded.parking_records as ParkingRecord[]) ?? [])[0] ?? null,
        );
        setCandidates(
          (loaded.random_candidates as RandomCandidate[]) ?? [],
        );
        setDemoMode(false);
        setIsDataLoading(false);
      })
      .catch((error: Error) => {
        if (!active) return;
        setEvents(seedEvents);
        setDaysOff(seedDaysOff);
        setTodos(seedTodos);
        setShopping(seedShopping);
        setTrips(seedTrips);
        setTripFlights([]);
        setTripAccommodations([]);
        setTripTransportations([]);
        setTripFoods([]);
        setTripPlaces([]);
        setFridge(seedFridge);
        setParking(seedParking);
        setCandidates(seedCandidates);
        setDemoMode(true);
        setIsDataLoading(false);
        if (error.message !== "SUPABASE_NOT_CONFIGURED") {
          showToast("데이터를 불러오지 못해 미리보기로 열었어요.");
        }
      });

    return () => {
      active = false;
    };
  }, [authState, currentUser, showToast]);

  useEffect(() => {
    if (
      authState !== "ready" ||
      loadedHolidayYears.current.has(holidayYear)
    ) {
      return;
    }
    loadedHolidayYears.current.add(holidayYear);

    fetch(`/api/holidays?year=${holidayYear}`)
      .then(async (response) => {
        if (!response.ok) throw new Error("HOLIDAY_LOAD_FAILED");
        return (await response.json()) as PublicHoliday[];
      })
      .then((rows) => {
        setHolidays((items) => {
          const merged = new Map(items.map((item) => [item.date, item]));
          rows.forEach((item) => merged.set(item.date, item));
          return [...merged.values()].sort((a, b) =>
            a.date.localeCompare(b.date),
          );
        });
      })
      .catch(() => {
        loadedHolidayYears.current.delete(holidayYear);
        showToast("공휴일을 불러오지 못했습니다.");
      });
  }, [authState, holidayYear, showToast]);

  async function writeRecord(
    method: "POST" | "PATCH" | "DELETE",
    resource: string,
    payload?: Record<string, unknown>,
    id?: string,
  ) {
    const query = new URLSearchParams({ resource });
    if (id) query.set("id", id);
    try {
      const response = await fetch(`/api/records?${query.toString()}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: payload ? JSON.stringify(payload) : undefined,
      });
      if (!response.ok) {
        const error = (await response.json().catch(() => ({}))) as {
          code?: string;
        };
        if (error.code === "SUPABASE_NOT_CONFIGURED") {
          setDemoMode(true);
          showToast("미리보기 데이터에 반영했어요.");
          return true;
        }
        throw new Error("WRITE_FAILED");
      }
      showToast("저장했어요.");
      return true;
    } catch {
      showToast("저장하지 못했어요. 잠시 후 다시 시도해 주세요.");
      return false;
    }
  }

  function chooseUser(user: UserCode) {
    localStorage.setItem("oip.currentUser", user);
    setIsDataLoading(true);
    setDemoMode(false);
    setCurrentUser(user);
    setAuthState("ready");
  }

  async function signOutDevice() {
    await fetch("/api/auth", { method: "DELETE" }).catch(() => undefined);
    localStorage.removeItem("oip.currentUser");
    setIsDataLoading(true);
    setAuthState("locked");
  }

  function openEventModal(range?: DateRange) {
    const nextRange = range ?? { start: selectedDate, end: selectedDate };
    setEventRange(nextRange);
    setEventScope("personal");
    setSelectedDate(nextRange.start);
    setModal("event");
  }

  function addEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const title = String(form.get("title") ?? "").trim();
    const startDate = String(form.get("start_date") ?? "");
    const endDate = String(form.get("end_date") ?? startDate);
    const startTime = String(form.get("start_time") ?? "");
    const endTime = String(form.get("end_time") ?? "");
    const requestedColor = String(form.get("custom_color") ?? "");
    const customColor = EVENT_COLOR_OPTIONS.some(
      (option) => option.value && option.value === requestedColor,
    )
      ? requestedColor
      : null;
    const isShared = eventScope === "shared";
    const isPrivate = eventScope === "private";
    if (!title || !startDate || !endDate || endDate < startDate) return;
    const isAllDay = !startTime && !endTime;
    const next: CalendarEvent = {
      id: newId(),
      title,
      start_at: `${startDate}T${startTime || (isAllDay ? "12:00" : "00:00")}:00+09:00`,
      end_at:
        endDate !== startDate || endTime
          ? `${endDate}T${endTime || "23:59"}:${endTime ? "00" : "59"}+09:00`
          : null,
      is_all_day: isAllDay,
      visibility: isPrivate ? "private" : "shared",
      author_id: currentUser,
      event_type: "normal",
      color_mode: !isPrivate && !isShared ? "custom" : "default",
      custom_color: customColor,
    };
    setEvents((items) => [...items, next]);
    setSelectedDate(startDate);
    setModal(null);
    void writeRecord("POST", "calendar_events", next);
  }

  function addDayOff(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const date = String(form.get("date") ?? "");
    const owner = String(form.get("owner") ?? currentUser) as UserCode;
    const type = String(form.get("type") ?? "");
    if (!date || !type) return;
    const next: DayOff = {
      id: newId(),
      date,
      owner_id: owner,
      day_off_type: type,
      half_day_period: null,
    };
    setDaysOff((items) => [...items, next]);
    setSelectedDate(date);
    setModal(null);
    void writeRecord("POST", "calendar_days_off", next);
  }

  function deleteEvent(item: CalendarEvent) {
    if (!globalThis.confirm(`"${item.title}" 일정을 삭제할까요?`)) return;
    setEvents((items) => items.filter((entry) => entry.id !== item.id));
    void writeRecord(
      "DELETE",
      "calendar_events",
      undefined,
      item.id,
    ).then((saved) => {
      if (!saved) setEvents((items) => [...items, item]);
    });
  }

  function deleteDayOff(item: DayOff) {
    if (
      !globalThis.confirm(
        `${USER_META[item.owner_id].name}의 ${item.day_off_type} 휴무를 삭제할까요?`,
      )
    ) {
      return;
    }
    setDaysOff((items) => items.filter((entry) => entry.id !== item.id));
    void writeRecord(
      "DELETE",
      "calendar_days_off",
      undefined,
      item.id,
    ).then((saved) => {
      if (!saved) setDaysOff((items) => [...items, item]);
    });
  }

  function createTodo(
    title: string,
    visibility: Visibility,
    dueAt?: string,
  ) {
    const next: Todo = {
      id: newId(),
      title,
      due_at: dueAt ?? null,
      is_completed: false,
      visibility,
      author_id: currentUser,
      created_at: new Date().toISOString(),
    };
    setTodos((items) => [next, ...items]);
    void writeRecord("POST", "todos", next);
  }

  function toggleTodo(item: Todo) {
    const completed = !item.is_completed;
    setTodos((items) =>
      items.map((entry) =>
        entry.id === item.id
          ? {
              ...entry,
              is_completed: completed,
              completed_at: completed ? new Date().toISOString() : null,
            }
          : entry,
      ),
    );
    void writeRecord(
      "PATCH",
      "todos",
      {
        is_completed: completed,
        completed_at: completed ? new Date().toISOString() : null,
      },
      item.id,
    ).then((saved) => {
      if (!saved) {
        setTodos((items) =>
          items.map((entry) => (entry.id === item.id ? item : entry)),
        );
      }
    });
  }

  function deleteTodo(item: Todo) {
    if (!globalThis.confirm(`"${item.title}" 항목을 삭제할까요?`)) return;
    setTodos((items) => items.filter((entry) => entry.id !== item.id));
    void writeRecord("DELETE", "todos", undefined, item.id).then((saved) => {
      if (!saved) setTodos((items) => [item, ...items]);
    });
  }

  function createShopping(name: string) {
    const next: ShoppingItem = {
      id: newId(),
      name,
      quantity: 1,
      unit: "개",
      category: "기타",
      is_purchased: false,
      added_by: currentUser,
      created_at: new Date().toISOString(),
    };
    setShopping((items) => [next, ...items]);
    void writeRecord("POST", "shopping_items", next);
  }

  function toggleShopping(item: ShoppingItem) {
    const purchased = !item.is_purchased;
    const timestamp = purchased ? new Date().toISOString() : null;
    setShopping((items) =>
      items.map((entry) =>
        entry.id === item.id
          ? {
              ...entry,
              is_purchased: purchased,
              purchased_by: purchased ? currentUser : null,
              purchased_at: timestamp,
            }
          : entry,
      ),
    );
    void writeRecord(
      "PATCH",
      "shopping_items",
      {
        is_purchased: purchased,
        purchased_by: purchased ? currentUser : null,
        purchased_at: timestamp,
      },
      item.id,
    ).then((saved) => {
      if (!saved) {
        setShopping((items) =>
          items.map((entry) => (entry.id === item.id ? item : entry)),
        );
      }
    });
  }

  function clearShopping() {
    if (!globalThis.confirm("구매 완료한 품목을 모두 삭제할까요?")) return;
    const completed = shopping.filter((item) => item.is_purchased);
    setShopping((items) => items.filter((item) => !item.is_purchased));
    completed.forEach((item) => {
      void writeRecord("DELETE", "shopping_items", undefined, item.id);
    });
  }

  function addTrip(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const title = String(form.get("title") ?? "").trim();
    const destination = String(form.get("destination") ?? "").trim();
    const start = String(form.get("start") ?? "");
    const end = String(form.get("end") ?? "");
    if (!title || !destination || !start || !end || end < start) return;
    const next: Trip = {
      id: newId(),
      title,
      destination,
      start_date: start,
      end_date: end,
      memo: String(form.get("memo") ?? ""),
      author_id: currentUser,
    };
    setTrips((items) => [...items, next]);
    setModal(null);
    void writeRecord("POST", "trips", next);
  }

  function saveTripDetail(
    resource: TripDetailResource,
    payload: Record<string, unknown>,
    id?: string,
  ) {
    const next = { id: id ?? newId(), ...payload };
    if (resource === "trip_flights") {
      setTripFlights((items) =>
        id
          ? items.map((item) =>
              item.id === id ? ({ ...item, ...payload } as TripFlight) : item,
            )
          : [...items, next as TripFlight],
      );
    } else if (resource === "trip_accommodations") {
      setTripAccommodations((items) =>
        id
          ? items.map((item) =>
              item.id === id
                ? ({ ...item, ...payload } as TripAccommodation)
                : item,
            )
          : [...items, next as TripAccommodation],
      );
    } else if (resource === "trip_transportations") {
      setTripTransportations((items) =>
        id
          ? items.map((item) =>
              item.id === id
                ? ({ ...item, ...payload } as TripTransportation)
                : item,
            )
          : [...items, next as TripTransportation],
      );
    } else if (resource === "trip_foods") {
      setTripFoods((items) =>
        id
          ? items.map((item) =>
              item.id === id ? ({ ...item, ...payload } as TripFood) : item,
            )
          : [...items, next as TripFood],
      );
    } else {
      setTripPlaces((items) =>
        id
          ? items.map((item) =>
              item.id === id ? ({ ...item, ...payload } as TripPlace) : item,
            )
          : [...items, next as TripPlace],
      );
    }
    void writeRecord(id ? "PATCH" : "POST", resource, id ? payload : next, id);
  }

  function deleteTripDetail(resource: TripDetailResource, id: string) {
    if (resource === "trip_flights") {
      setTripFlights((items) => items.filter((item) => item.id !== id));
    } else if (resource === "trip_accommodations") {
      setTripAccommodations((items) =>
        items.filter((item) => item.id !== id),
      );
    } else if (resource === "trip_transportations") {
      setTripTransportations((items) =>
        items.filter((item) => item.id !== id),
      );
    } else if (resource === "trip_foods") {
      setTripFoods((items) => items.filter((item) => item.id !== id));
    } else {
      setTripPlaces((items) => items.filter((item) => item.id !== id));
    }
    void writeRecord("DELETE", resource, undefined, id);
  }

  function deleteTrip(item: Trip) {
    if (!globalThis.confirm(`"${item.title}" 여행과 세부 내용을 모두 삭제할까요?`)) {
      return;
    }
    const removedFlights = tripFlights.filter(
      (entry) => entry.trip_id === item.id,
    );
    const removedAccommodations = tripAccommodations.filter(
      (entry) => entry.trip_id === item.id,
    );
    const removedTransportations = tripTransportations.filter(
      (entry) => entry.trip_id === item.id,
    );
    const removedFoods = tripFoods.filter((entry) => entry.trip_id === item.id);
    const removedPlaces = tripPlaces.filter(
      (entry) => entry.trip_id === item.id,
    );

    setTrips((items) => items.filter((entry) => entry.id !== item.id));
    setTripFlights((items) =>
      items.filter((entry) => entry.trip_id !== item.id),
    );
    setTripAccommodations((items) =>
      items.filter((entry) => entry.trip_id !== item.id),
    );
    setTripTransportations((items) =>
      items.filter((entry) => entry.trip_id !== item.id),
    );
    setTripFoods((items) =>
      items.filter((entry) => entry.trip_id !== item.id),
    );
    setTripPlaces((items) =>
      items.filter((entry) => entry.trip_id !== item.id),
    );

    void writeRecord("DELETE", "trips", undefined, item.id).then((saved) => {
      if (saved) return;
      setTrips((items) => [...items, item]);
      setTripFlights((items) => [...items, ...removedFlights]);
      setTripAccommodations((items) => [
        ...items,
        ...removedAccommodations,
      ]);
      setTripTransportations((items) => [
        ...items,
        ...removedTransportations,
      ]);
      setTripFoods((items) => [...items, ...removedFoods]);
      setTripPlaces((items) => [...items, ...removedPlaces]);
    });
  }

  function toggleTripVisited(
    resource: "trip_foods" | "trip_places",
    id: string,
    isVisited: boolean,
  ) {
    if (resource === "trip_foods") {
      setTripFoods((items) =>
        items.map((item) =>
          item.id === id ? { ...item, is_visited: isVisited } : item,
        ),
      );
    } else {
      setTripPlaces((items) =>
        items.map((item) =>
          item.id === id ? { ...item, is_visited: isVisited } : item,
        ),
      );
    }
    void writeRecord("PATCH", resource, { is_visited: isVisited }, id);
  }

  function saveFridge(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    const expiration = String(form.get("expiration") ?? "");
    if (!name || !expiration) return;
    const next: FridgeItem = {
      id: editingFridge?.id ?? newId(),
      name,
      quantity: Math.max(1, Number(form.get("quantity") ?? 1)),
      unit: String(form.get("unit") ?? "개"),
      expiration_date: expiration,
      storage_type: String(form.get("storage") ?? "냉장"),
      category: String(form.get("category") ?? "기타"),
      purchased_at: optionalFormValue(form, "purchased_at"),
      memo: optionalFormValue(form, "memo"),
      author_id: editingFridge?.author_id ?? currentUser,
    };
    if (editingFridge) {
      setFridge((items) =>
        items.map((item) => (item.id === editingFridge.id ? next : item)),
      );
      void writeRecord("PATCH", "fridge_items", next, editingFridge.id);
    } else {
      setFridge((items) => [...items, next]);
      void writeRecord("POST", "fridge_items", next);
    }
    setEditingFridge(null);
    setModal(null);
  }

  function consumeFridge(item: FridgeItem) {
    setFridge((items) => items.filter((entry) => entry.id !== item.id));
    void writeRecord(
      "PATCH",
      "fridge_items",
      { consumed_at: new Date().toISOString() },
      item.id,
    ).then((saved) => {
      if (!saved) setFridge((items) => [...items, item]);
    });
  }

  function saveParking(next: ParkingRecord) {
    const previous = parking;
    setParking(next);
    void writeRecord("POST", "parking_records", next).then((saved) => {
      if (!saved) setParking(previous);
    });
  }

  function addCandidate(
    type: RandomCandidate["type"],
    name: string,
    category: string,
  ) {
    const next: RandomCandidate = {
      id: newId(),
      type,
      name,
      category,
      is_active: true,
      author_id: currentUser,
    };
    setCandidates((items) => [next, ...items]);
    void writeRecord("POST", "random_candidates", next);
  }

  function toggleCandidate(item: RandomCandidate) {
    const active = !item.is_active;
    setCandidates((items) =>
      items.map((entry) =>
        entry.id === item.id ? { ...entry, is_active: active } : entry,
      ),
    );
    void writeRecord(
      "PATCH",
      "random_candidates",
      { is_active: active },
      item.id,
    );
  }

  function deleteCandidate(item: RandomCandidate) {
    setCandidates((items) => items.filter((entry) => entry.id !== item.id));
    void writeRecord("DELETE", "random_candidates", undefined, item.id);
  }

  if (authState === "checking") return <LoadingScreen />;
  if (authState === "locked") {
    return (
      <PasswordGate
        onToggleTheme={toggleTheme}
        onAuthenticated={() => {
          const stored = localStorage.getItem("oip.currentUser");
          if (stored === "daeho" || stored === "sanghee") {
            setIsDataLoading(true);
            setDemoMode(false);
            setCurrentUser(stored);
            setAuthState("ready");
          } else {
            setAuthState("selecting");
          }
        }}
        theme={theme}
      />
    );
  }
  if (authState === "selecting") {
    return (
      <UserGate
        onSelect={chooseUser}
        onToggleTheme={toggleTheme}
        theme={theme}
      />
    );
  }

  const activeTab = MAIN_TABS.find((tab) => tab.id === mainTab) ?? MAIN_TABS[0];

  return (
    <div className="app-shell">
      <aside className="desktop-nav">
        <div className="desktop-brand">
          <CloverLogo />
          <span>
            <strong>OIP</strong>
          </span>
        </div>
        <nav aria-label="주 메뉴">
          {MAIN_TABS.map((tab) => (
            <button
              aria-current={mainTab === tab.id ? "page" : undefined}
              className={mainTab === tab.id ? "is-active" : ""}
              key={tab.id}
              onClick={() => setMainTab(tab.id)}
              type="button"
            >
              <span>{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </nav>
      </aside>

      <div className="app-main">
        <header className="app-header">
          <div className="mobile-brand">
            <CloverLogo />
            <strong>OIP</strong>
          </div>
          <div>
            <h1>{activeTab.title}</h1>
          </div>
          <div className="header-actions">
            <ThemeToggleButton theme={theme} onToggle={toggleTheme} />
            <button
              aria-label={`현재 사용자 ${USER_META[currentUser].name}, 사용자 변경`}
              className={`user-pill user-pill--${currentUser}`}
              onClick={() => setAuthState("selecting")}
              type="button"
            >
              {USER_META[currentUser].name}
            </button>
            <button
              aria-label="이 기기 인증 해제"
              className="logout-button"
              onClick={signOutDevice}
              type="button"
            >
              인증 해제
            </button>
          </div>
        </header>

        {demoMode ? (
          <div className="demo-banner" role="status">
            <span>미리보기</span>
            Supabase 연결 전이라 변경 내용은 새로고침하면 초기화됩니다.
          </div>
        ) : null}

        <main
          className={`content${
            mainTab === "schedule" && scheduleTab === "calendar"
              ? " content--calendar"
              : ""
          }`}
        >
          {isDataLoading ? (
            <DataLoadingSkeleton />
          ) : (
            <>
          {mainTab === "schedule" ? (
            <>
              <div className="sub-tabs" role="tablist" aria-label="일정 메뉴">
                {(
                  [
                    ["calendar", "캘린더"],
                    ["todo", "TODO"],
                    ["shopping", "쇼핑목록"],
                  ] as Array<[ScheduleTab, string]>
                ).map(([id, label]) => (
                  <button
                    aria-selected={scheduleTab === id}
                    className={scheduleTab === id ? "is-active" : ""}
                    key={id}
                    onClick={() => setScheduleTab(id)}
                    role="tab"
                    type="button"
                  >
                    {label}
                    {id === "todo" && todos.filter((item) => !item.is_completed).length
                      ? ` ${todos.filter((item) => !item.is_completed).length}`
                      : ""}
                    {id === "shopping" &&
                    shopping.filter((item) => !item.is_purchased).length
                      ? ` ${shopping.filter((item) => !item.is_purchased).length}`
                      : ""}
                  </button>
                ))}
              </div>
              {scheduleTab === "calendar" ? (
                <CalendarView
                  daysOff={daysOff}
                  events={events}
                  holidays={holidays}
                  onAddDayOff={() => setModal("dayoff")}
                  onAddEvent={openEventModal}
                  onDeleteDayOff={deleteDayOff}
                  onDeleteEvent={deleteEvent}
                  onVisibleYearChange={setHolidayYear}
                  selectedDate={selectedDate}
                  setSelectedDate={setSelectedDate}
                />
              ) : scheduleTab === "todo" ? (
                <TodoView
                  currentUser={currentUser}
                  onCreate={createTodo}
                  onDelete={deleteTodo}
                  onToggle={toggleTodo}
                  todos={todos}
                />
              ) : (
                <ShoppingView
                  currentUser={currentUser}
                  items={shopping}
                  onClearCompleted={clearShopping}
                  onCreate={createShopping}
                  onToggle={toggleShopping}
                />
              )}
            </>
          ) : null}

          {mainTab === "travel" ? (
            <TravelView
              accommodations={tripAccommodations}
              flights={tripFlights}
              foods={tripFoods}
              onAdd={() => setModal("trip")}
              onDeleteDetail={deleteTripDetail}
              onDeleteTrip={deleteTrip}
              onSaveDetail={saveTripDetail}
              onToggleVisited={toggleTripVisited}
              places={tripPlaces}
              transportations={tripTransportations}
              trips={trips}
            />
          ) : null}

          {mainTab === "fridge" ? (
            <FridgeView
              items={fridge}
              onAdd={() => {
                setEditingFridge(null);
                setModal("fridge");
              }}
              onConsume={consumeFridge}
              onEdit={(item) => {
                setEditingFridge(item);
                setModal("fridge");
              }}
            />
          ) : null}

          {mainTab === "parking" ? (
            <ParkingView
              currentUser={currentUser}
              onSave={saveParking}
              record={parking}
            />
          ) : null}

          {mainTab === "etc" ? (
            <EtcView
              candidates={candidates}
              currentUser={currentUser}
              onAdd={addCandidate}
              onDelete={deleteCandidate}
              onToggle={toggleCandidate}
            />
          ) : null}
            </>
          )}
        </main>

        <nav className="mobile-nav" aria-label="주 메뉴">
          {MAIN_TABS.map((tab) => (
            <button
              aria-current={mainTab === tab.id ? "page" : undefined}
              className={mainTab === tab.id ? "is-active" : ""}
              key={tab.id}
              onClick={() => setMainTab(tab.id)}
              type="button"
            >
              <span>{tab.icon}</span>
              <small>{tab.label}</small>
            </button>
          ))}
        </nav>
      </div>

      {modal === "event" ? (
        <Modal
          className="modal-card--event"
          headerAction={
            <EventVisibilityControls
              onChange={setEventScope}
              scope={eventScope}
            />
          }
          onClose={() => setModal(null)}
          title="일정 추가"
        >
          <EventForm
            currentUser={currentUser}
            initialRange={eventRange}
            onSubmit={addEvent}
            scope={eventScope}
          />
        </Modal>
      ) : null}

      {modal === "dayoff" ? (
        <Modal
          description="휴무는 날짜 칸의 연한 배경으로 표시됩니다."
          onClose={() => setModal(null)}
          title="휴무 추가"
        >
          <form className="modal-form" onSubmit={addDayOff}>
            <div className="field-row">
              <label className="field">
                <span>날짜 *</span>
                <input
                  defaultValue={selectedDate}
                  name="date"
                  required
                  type="date"
                />
              </label>
              <label className="field">
                <span>사용자</span>
                <select defaultValue={currentUser} name="owner">
                  <option value="daeho">대호</option>
                  <option value="sanghee">상희</option>
                </select>
              </label>
            </div>
            <label className="field">
              <span>휴무 종류 *</span>
              <select defaultValue="연차" name="type">
                <option>연차</option>
                <option>패밀리데이</option>
                <option>해피프라이데이</option>
                <option>기타 휴무</option>
              </select>
            </label>
            <button className="button button--primary button--full" type="submit">
              휴무 저장
            </button>
          </form>
        </Modal>
      ) : null}

      {modal === "trip" ? (
        <Modal
          description="여행 기간과 기본 정보를 먼저 등록해 주세요."
          onClose={() => setModal(null)}
          title="여행 추가"
        >
          <form className="modal-form" onSubmit={addTrip}>
            <label className="field">
              <span>여행 제목 *</span>
              <input autoFocus name="title" placeholder="예: 가을 교토" required />
            </label>
            <label className="field">
              <span>여행지 *</span>
              <input name="destination" placeholder="도시 또는 지역" required />
            </label>
            <div className="field-row">
              <label className="field">
                <span>출발일 *</span>
                <input name="start" required type="date" />
              </label>
              <label className="field">
                <span>종료일 *</span>
                <input name="end" required type="date" />
              </label>
            </div>
            <label className="field">
              <span>메모</span>
              <textarea name="memo" placeholder="함께 기억할 내용" rows={3} />
            </label>
            <button className="button button--primary button--full" type="submit">
              여행 저장
            </button>
          </form>
        </Modal>
      ) : null}

      {modal === "fridge" ? (
        <Modal
          description={
            editingFridge
              ? "수량과 유통기한 등 필요한 내용을 수정합니다."
              : "유통기한이 가까운 순서로 자동 정렬됩니다."
          }
          onClose={() => {
            setEditingFridge(null);
            setModal(null);
          }}
          title={editingFridge ? "냉장고 아이템 편집" : "냉장고 아이템 추가"}
        >
          <form className="modal-form" onSubmit={saveFridge}>
            <label className="field">
              <span>아이템 이름 *</span>
              <input
                autoFocus
                defaultValue={editingFridge?.name}
                name="name"
                placeholder="예: 두부"
                required
              />
            </label>
            <div className="field-row field-row--three">
              <label className="field">
                <span>수량</span>
                <input
                  defaultValue={editingFridge?.quantity ?? 1}
                  min="1"
                  name="quantity"
                  type="number"
                />
              </label>
              <label className="field">
                <span>단위</span>
                <select defaultValue={editingFridge?.unit ?? "개"} name="unit">
                  <option>개</option>
                  <option>봉</option>
                  <option>팩</option>
                  <option>병</option>
                  <option>g</option>
                </select>
              </label>
              <label className="field">
                <span>보관</span>
                <select
                  defaultValue={editingFridge?.storage_type ?? "냉장"}
                  name="storage"
                >
                  <option>냉장</option>
                  <option>냉동</option>
                  <option>실온</option>
                  <option>기타</option>
                </select>
              </label>
            </div>
            <div className="field-row">
              <label className="field">
                <span>유통기한 *</span>
                <input
                  defaultValue={editingFridge?.expiration_date ?? addDays(7)}
                  name="expiration"
                  required
                  type="date"
                />
              </label>
              <label className="field">
                <span>카테고리</span>
                <input
                  defaultValue={editingFridge?.category ?? ""}
                  name="category"
                  placeholder="예: 유제품"
                />
              </label>
            </div>
            <div className="field-row">
              <label className="field">
                <span>구입일</span>
                <input
                  defaultValue={editingFridge?.purchased_at ?? ""}
                  name="purchased_at"
                  type="date"
                />
              </label>
              <label className="field">
                <span>메모</span>
                <input
                  defaultValue={editingFridge?.memo ?? ""}
                  name="memo"
                />
              </label>
            </div>
            <button className="button button--primary button--full" type="submit">
              {editingFridge ? "수정 저장" : "아이템 저장"}
            </button>
          </form>
        </Modal>
      ) : null}

      {toast ? (
        <div className="toast" role="status" aria-live="polite">
          <span>✓</span>
          {toast}
        </div>
      ) : null}
    </div>
  );
}
