"use client";

import {
  FormEvent,
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import type {
  CalendarEvent,
  DayOff,
  FridgeItem,
  ParkingRecord,
  RandomCandidate,
  ShoppingItem,
  Todo,
  Trip,
  UserCode,
  Visibility,
} from "../oip-types";

type MainTab = "schedule" | "travel" | "fridge" | "parking" | "etc";
type ScheduleTab = "calendar" | "todo" | "shopping";
type ModalName = "event" | "dayoff" | "trip" | "fridge" | null;

const USER_META: Record<
  UserCode,
  { name: string; short: string; color: string }
> = {
  daeho: { name: "대호", short: "대", color: "#7fa99b" },
  sanghee: { name: "상희", short: "상", color: "#e9a6ad" },
};

const MAIN_TABS: Array<{
  id: MainTab;
  label: string;
  icon: string;
  title: string;
}> = [
  { id: "schedule", label: "일정", icon: "▦", title: "우리의 일정" },
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

function newId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

function formatKoreanDate(value: string, includeYear = false) {
  const date = parseDateKey(value.slice(0, 10));
  return new Intl.DateTimeFormat("ko-KR", {
    ...(includeYear ? { year: "numeric" as const } : {}),
    month: "short",
    day: "numeric",
    weekday: "short",
  }).format(date);
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
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
    visibility: "private",
    author_id: "daeho",
    event_type: "normal",
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
    >
      <span />
      <span />
      <span />
      <span />
      <span />
      <i />
    </span>
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

function PasswordGate({
  onAuthenticated,
}: {
  onAuthenticated: () => void;
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
      <section className="gate-card">
        <div className="gate-brand">
          <CloverLogo large />
          <div>
            <p className="eyebrow">우리 둘의 생활 기록</p>
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

function UserGate({ onSelect }: { onSelect: (user: UserCode) => void }) {
  return (
    <main className="gate-screen">
      <section className="gate-card">
        <CloverLogo large />
        <p className="eyebrow">OIP에 오신 걸 환영해요</p>
        <h1 className="user-gate-title">누가 사용 중인가요?</h1>
        <p className="gate-copy">이 기기에서 사용할 이름을 선택해 주세요.</p>
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
              <small>선택하기</small>
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
  onClose,
  children,
}: {
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        aria-labelledby="modal-title"
        aria-modal="true"
        className="modal-card"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="modal-head">
          <div>
            <h2 id="modal-title">{title}</h2>
            {description ? <p>{description}</p> : null}
          </div>
          <button
            aria-label="닫기"
            className="icon-button"
            onClick={onClose}
            type="button"
          >
            ×
          </button>
        </div>
        {children}
      </section>
    </div>
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

function CalendarView({
  events,
  daysOff,
  selectedDate,
  setSelectedDate,
  onAddEvent,
  onAddDayOff,
}: {
  events: CalendarEvent[];
  daysOff: DayOff[];
  selectedDate: string;
  setSelectedDate: (date: string) => void;
  onAddEvent: () => void;
  onAddDayOff: () => void;
}) {
  const selected = parseDateKey(selectedDate);
  const [visibleMonth, setVisibleMonth] = useState(
    new Date(selected.getFullYear(), selected.getMonth(), 1),
  );

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

  const allEvents = [...events, ...systemEvents];
  const year = visibleMonth.getFullYear();
  const month = visibleMonth.getMonth();
  const firstWeekday = new Date(year, month, 1).getDay();
  const firstCell = new Date(year, month, 1 - firstWeekday);
  const days = Array.from({ length: 42 }, (_, index) => {
    const date = new Date(firstCell);
    date.setDate(firstCell.getDate() + index);
    return date;
  });

  const selectedEvents = allEvents.filter(
    (event) => event.start_at.slice(0, 10) === selectedDate,
  );
  const selectedDaysOff = daysOff.filter((item) => item.date === selectedDate);

  function moveMonth(offset: number) {
    const next = new Date(year, month + offset, 1);
    setVisibleMonth(next);
    setSelectedDate(toDateKey(next));
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
            className="month-title"
            onClick={() => {
              const today = new Date();
              setVisibleMonth(
                new Date(today.getFullYear(), today.getMonth(), 1),
              );
              setSelectedDate(toDateKey(today));
            }}
            type="button"
          >
            <strong>
              {year}년 {month + 1}월
            </strong>
            <small>오늘로 이동</small>
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
        <div className="calendar-grid">
          {days.map((date) => {
            const key = toDateKey(date);
            const dateEvents = allEvents.filter(
              (event) => event.start_at.slice(0, 10) === key,
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
            const isSelected = key === selectedDate;
            return (
              <button
                aria-label={`${formatKoreanDate(key, true)}${
                  dateEvents.length ? `, 일정 ${dateEvents.length}개` : ""
                }`}
                className={[
                  "calendar-day",
                  isOutside ? "calendar-day--outside" : "",
                  isToday ? "calendar-day--today" : "",
                  isSelected ? "calendar-day--selected" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                key={key}
                onClick={() => setSelectedDate(key)}
                style={{ background }}
                type="button"
              >
                <span className="day-number">{date.getDate()}</span>
                <span className="day-events">
                  {dateEvents.slice(0, 2).map((event) => (
                    <span
                      className={`event-chip event-chip--${
                        event.event_type === "anniversary"
                          ? "system"
                          : event.visibility === "shared"
                            ? "shared"
                            : event.author_id
                      }`}
                      key={event.id}
                      style={
                        event.custom_color
                          ? { backgroundColor: event.custom_color }
                          : undefined
                      }
                    >
                      {event.is_all_day
                        ? ""
                        : `${event.start_at.slice(11, 16)} `}
                      {event.title}
                    </span>
                  ))}
                  {dateEvents.length > 2 ? (
                    <span className="more-events">+{dateEvents.length - 2}</span>
                  ) : null}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <aside className="card day-detail">
        <div className="section-heading">
          <div>
            <p className="eyebrow">선택한 날짜</p>
            <h2>{formatKoreanDate(selectedDate, true)}</h2>
          </div>
          <div className="small-actions">
            <button className="button button--soft" onClick={onAddDayOff}>
              휴무
            </button>
            <button className="button button--primary" onClick={onAddEvent}>
              + 일정
            </button>
          </div>
        </div>

        {selectedDaysOff.length ? (
          <div className="dayoff-list">
            {selectedDaysOff.map((item) => (
              <div className={`dayoff-row dayoff-row--${item.owner_id}`} key={item.id}>
                <AuthorBadge user={item.owner_id} />
                <strong>{item.day_off_type}</strong>
                {item.half_day_period ? (
                  <span>{item.half_day_period === "am" ? "오전" : "오후"}</span>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}

        {selectedEvents.length ? (
          <div className="detail-list">
            {selectedEvents.map((event) => (
              <article className="detail-row" key={event.id}>
                <span
                  className={`detail-dot detail-dot--${
                    event.event_type === "anniversary"
                      ? "system"
                      : event.visibility === "shared"
                        ? "shared"
                        : event.author_id
                  }`}
                />
                <div>
                  <strong>{event.title}</strong>
                  <p>
                    {event.is_all_day
                      ? "종일"
                      : `${event.start_at.slice(11, 16)} 시작`}
                    {" · "}
                    {event.event_type === "anniversary"
                      ? "기념일"
                      : event.visibility === "shared"
                        ? "공동 일정"
                        : `${USER_META[event.author_id as UserCode].name} 개인`}
                  </p>
                </div>
              </article>
            ))}
          </div>
        ) : !selectedDaysOff.length ? (
          <EmptyState
            action="일정 추가"
            icon="◷"
            onAction={onAddEvent}
            title="이 날짜에는 일정이 없어요"
          />
        ) : null}
      </aside>
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

function TravelView({
  trips,
  onAdd,
}: {
  trips: Trip[];
  onAdd: () => void;
}) {
  const today = toDateKey(new Date());
  const upcoming = [...trips]
    .filter((trip) => trip.end_date >= today)
    .sort((a, b) => a.start_date.localeCompare(b.start_date));
  const past = [...trips]
    .filter((trip) => trip.end_date < today)
    .sort((a, b) => b.end_date.localeCompare(a.end_date));
  const [selectedTrip, setSelectedTrip] = useState<string | null>(
    upcoming[0]?.id ?? null,
  );
  const detail = trips.find((trip) => trip.id === selectedTrip);

  return (
    <section className="travel-layout">
      <div>
        <div className="page-lead">
          <div>
            <p className="eyebrow">다가오는 순간</p>
            <h2>다음 여행을 한눈에</h2>
            <p>예약 정보부터 먹고 싶은 것까지 차곡차곡 모아 두세요.</p>
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
                  className={`trip-card${selectedTrip === trip.id ? " trip-card--selected" : ""}`}
                  key={trip.id}
                  onClick={() => setSelectedTrip(trip.id)}
                  style={{ animationDelay: `${index * 50}ms` }}
                  type="button"
                >
                  <div className="trip-visual">
                    <span>{trip.destination.includes("일본") ? "京都" : "여행"}</span>
                    <small>{inProgress ? "여행 중" : `D-${daysUntil(trip.start_date)}`}</small>
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
              title="첫 여행을 기록해 보세요"
            />
          </div>
        )}

        {past.length ? (
          <details className="past-trips">
            <summary>지난 여행 {past.length}개</summary>
            <div className="trip-list trip-list--past">
              {past.map((trip) => (
                <button
                  className="trip-card"
                  key={trip.id}
                  onClick={() => setSelectedTrip(trip.id)}
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
          <p className="eyebrow">여행 상세</p>
          <h2>{detail.title}</h2>
          <p className="trip-detail-period">
            {formatKoreanDate(detail.start_date, true)} —{" "}
            {formatKoreanDate(detail.end_date, true)}
          </p>
          <div className="trip-section-tabs">
            {["개요", "비행기", "숙소", "교통", "먹을 것", "갈 곳"].map(
              (label, index) => (
                <button
                  className={index === 0 ? "is-active" : ""}
                  key={label}
                  type="button"
                >
                  {label}
                </button>
              ),
            )}
          </div>
          <div className="trip-summary">
            <div>
              <span>✈</span>
              <p>가는 편</p>
              <strong>인천 → 간사이</strong>
              <small>08:40 출발</small>
            </div>
            <div>
              <span>⌂</span>
              <p>숙소</p>
              <strong>교토 가와라마치</strong>
              <small>체크인 15:00</small>
            </div>
            <div>
              <span>●</span>
              <p>메모</p>
              <strong>{detail.memo || "등록된 메모 없음"}</strong>
              <small>{USER_META[detail.author_id].name} 작성</small>
            </div>
          </div>
          <p className="setup-inline-note">
            세부 예약 정보 입력 화면은 다음 구현 단계에서 연결됩니다.
          </p>
        </aside>
      ) : null}
    </section>
  );
}

function FridgeView({
  items,
  onAdd,
  onConsume,
  onQuantity,
}: {
  items: FridgeItem[];
  onAdd: () => void;
  onConsume: (item: FridgeItem) => void;
  onQuantity: (item: FridgeItem, change: number) => void;
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
                  <strong className="expiry-badge">
                    {expiryLabel(item.expiration_date)}
                  </strong>
                </div>
                <h3>{item.name}</h3>
                <p>
                  {formatKoreanDate(item.expiration_date)}까지 ·{" "}
                  {item.category ?? "기타"}
                </p>
                <div className="quantity-control" aria-label={`${item.name} 수량`}>
                  <button
                    aria-label="수량 줄이기"
                    disabled={item.quantity <= 1}
                    onClick={() => onQuantity(item, -1)}
                    type="button"
                  >
                    −
                  </button>
                  <strong>
                    {item.quantity}
                    {item.unit ?? "개"}
                  </strong>
                  <button
                    aria-label="수량 늘리기"
                    onClick={() => onQuantity(item, 1)}
                    type="button"
                  >
                    +
                  </button>
                </div>
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
              <p>아래에서 위치를 선택해 주세요.</p>
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
            <span>1</span>
            <div>
              <strong>층 선택</strong>
              <small>주차한 지하층</small>
            </div>
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
            <span>2</span>
            <div>
              <strong>기둥 문자</strong>
              <small>A부터 D까지</small>
            </div>
          </div>
          <div className="choice-grid choice-grid--four">
            {(["A", "B", "C", "D"] as const).map((value) => (
              <button
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
        </div>
        <div className="picker-group">
          <div className="picker-label">
            <span>3</span>
            <div>
              <strong>기둥 번호</strong>
              <small>1부터 4까지</small>
            </div>
          </div>
          <div className="choice-grid choice-grid--four">
            {([1, 2, 3, 4] as const).map((value) => (
              <button
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

export function OipApp() {
  const [authState, setAuthState] = useState<
    "checking" | "locked" | "selecting" | "ready"
  >("checking");
  const [currentUser, setCurrentUser] = useState<UserCode>("daeho");
  const [mainTab, setMainTab] = useState<MainTab>("schedule");
  const [scheduleTab, setScheduleTab] = useState<ScheduleTab>("calendar");
  const [modal, setModal] = useState<ModalName>(null);
  const [selectedDate, setSelectedDate] = useState(toDateKey(new Date()));
  const [toast, setToast] = useState<string | null>(null);
  const [demoMode, setDemoMode] = useState(false);
  const [events, setEvents] = useState(seedEvents);
  const [daysOff, setDaysOff] = useState(seedDaysOff);
  const [todos, setTodos] = useState(seedTodos);
  const [shopping, setShopping] = useState(seedShopping);
  const [trips, setTrips] = useState(seedTrips);
  const [fridge, setFridge] = useState(seedFridge);
  const [parking, setParking] = useState<ParkingRecord | null>(seedParking);
  const [candidates, setCandidates] = useState(seedCandidates);

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
        setFridge((loaded.fridge_items as FridgeItem[]) ?? []);
        setParking(
          ((loaded.parking_records as ParkingRecord[]) ?? [])[0] ?? null,
        );
        setCandidates(
          (loaded.random_candidates as RandomCandidate[]) ?? [],
        );
        setDemoMode(false);
      })
      .catch((error: Error) => {
        if (!active) return;
        setDemoMode(true);
        if (error.message !== "SUPABASE_NOT_CONFIGURED") {
          showToast("데이터를 불러오지 못해 미리보기로 열었어요.");
        }
      });

    return () => {
      active = false;
    };
  }, [authState, currentUser, showToast]);

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
    setCurrentUser(user);
    setAuthState("ready");
  }

  async function signOutDevice() {
    await fetch("/api/auth", { method: "DELETE" }).catch(() => undefined);
    localStorage.removeItem("oip.currentUser");
    setAuthState("locked");
  }

  function addEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const title = String(form.get("title") ?? "").trim();
    const date = String(form.get("date") ?? "");
    const time = String(form.get("time") ?? "");
    const isShared = form.get("shared") === "on";
    if (!title || !date) return;
    const next: CalendarEvent = {
      id: newId(),
      title,
      start_at: `${date}T${time || "00:00"}:00+09:00`,
      is_all_day: !time,
      visibility: isShared ? "shared" : "private",
      author_id: currentUser,
      event_type: "normal",
    };
    setEvents((items) => [...items, next]);
    setSelectedDate(date);
    setModal(null);
    void writeRecord("POST", "calendar_events", next);
  }

  function addDayOff(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const date = String(form.get("date") ?? "");
    const owner = String(form.get("owner") ?? currentUser) as UserCode;
    const type = String(form.get("type") ?? "");
    const half = String(form.get("half") ?? "");
    if (!date || !type) return;
    const next: DayOff = {
      id: newId(),
      date,
      owner_id: owner,
      day_off_type: type,
      half_day_period:
        type === "반차" && (half === "am" || half === "pm") ? half : null,
    };
    setDaysOff((items) => [...items, next]);
    setSelectedDate(date);
    setModal(null);
    void writeRecord("POST", "calendar_days_off", next);
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

  function addFridge(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    const expiration = String(form.get("expiration") ?? "");
    if (!name || !expiration) return;
    const next: FridgeItem = {
      id: newId(),
      name,
      quantity: Math.max(1, Number(form.get("quantity") ?? 1)),
      unit: String(form.get("unit") ?? "개"),
      expiration_date: expiration,
      storage_type: String(form.get("storage") ?? "냉장"),
      category: String(form.get("category") ?? "기타"),
      author_id: currentUser,
    };
    setFridge((items) => [...items, next]);
    setModal(null);
    void writeRecord("POST", "fridge_items", next);
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

  function updateFridgeQuantity(item: FridgeItem, change: number) {
    const quantity = Math.max(1, item.quantity + change);
    setFridge((items) =>
      items.map((entry) =>
        entry.id === item.id ? { ...entry, quantity } : entry,
      ),
    );
    void writeRecord("PATCH", "fridge_items", { quantity }, item.id).then(
      (saved) => {
        if (!saved) {
          setFridge((items) =>
            items.map((entry) => (entry.id === item.id ? item : entry)),
          );
        }
      },
    );
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
        onAuthenticated={() => {
          const stored = localStorage.getItem("oip.currentUser");
          if (stored === "daeho" || stored === "sanghee") {
            setCurrentUser(stored);
            setAuthState("ready");
          } else {
            setAuthState("selecting");
          }
        }}
      />
    );
  }
  if (authState === "selecting") return <UserGate onSelect={chooseUser} />;

  const activeTab = MAIN_TABS.find((tab) => tab.id === mainTab) ?? MAIN_TABS[0];

  return (
    <div className="app-shell">
      <aside className="desktop-nav">
        <div className="desktop-brand">
          <CloverLogo />
          <span>
            <strong>OIP</strong>
            <small>우리 둘의 생활 기록</small>
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
            <p className="eyebrow">
              {mainTab === "schedule" ? "오늘도 함께" : "우리의 생활"}
            </p>
            <h1>{activeTab.title}</h1>
          </div>
          <div className="header-actions">
            <label className="user-select">
              <span className={`avatar avatar--${currentUser}`}>
                {USER_META[currentUser].short}
              </span>
              <span className="sr-only">현재 사용자</span>
              <select
                onChange={(event) =>
                  chooseUser(event.target.value as UserCode)
                }
                value={currentUser}
              >
                <option value="daeho">대호</option>
                <option value="sanghee">상희</option>
              </select>
            </label>
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

        <main className="content">
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
                  onAddDayOff={() => setModal("dayoff")}
                  onAddEvent={() => setModal("event")}
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
            <TravelView onAdd={() => setModal("trip")} trips={trips} />
          ) : null}

          {mainTab === "fridge" ? (
            <FridgeView
              items={fridge}
              onAdd={() => setModal("fridge")}
              onConsume={consumeFridge}
              onQuantity={updateFridgeQuantity}
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
          description="개인 일정이 기본이며 공동으로 바꿀 수 있어요."
          onClose={() => setModal(null)}
          title="일정 추가"
        >
          <form className="modal-form" onSubmit={addEvent}>
            <label className="field">
              <span>제목 *</span>
              <input autoFocus name="title" placeholder="일정 제목" required />
            </label>
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
                <span>시작 시간</span>
                <input name="time" type="time" />
              </label>
            </div>
            <label className="check-field">
              <input name="shared" type="checkbox" />
              <span>
                <strong>공동 일정</strong>
                <small>대호와 상희 모두에게 보여요</small>
              </span>
            </label>
            <button className="button button--primary button--full" type="submit">
              일정 저장
            </button>
          </form>
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
                <option>반차</option>
                <option>패밀리데이</option>
                <option>해피프라이데이</option>
                <option>기타 휴무</option>
              </select>
            </label>
            <label className="field">
              <span>반차 시간</span>
              <select defaultValue="am" name="half">
                <option value="am">오전</option>
                <option value="pm">오후</option>
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
          description="유통기한이 가까운 순서로 자동 정렬됩니다."
          onClose={() => setModal(null)}
          title="냉장고 아이템 추가"
        >
          <form className="modal-form" onSubmit={addFridge}>
            <label className="field">
              <span>아이템 이름 *</span>
              <input autoFocus name="name" placeholder="예: 두부" required />
            </label>
            <div className="field-row field-row--three">
              <label className="field">
                <span>수량</span>
                <input defaultValue="1" min="1" name="quantity" type="number" />
              </label>
              <label className="field">
                <span>단위</span>
                <select defaultValue="개" name="unit">
                  <option>개</option>
                  <option>봉</option>
                  <option>팩</option>
                  <option>병</option>
                  <option>g</option>
                </select>
              </label>
              <label className="field">
                <span>보관</span>
                <select defaultValue="냉장" name="storage">
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
                  defaultValue={addDays(7)}
                  name="expiration"
                  required
                  type="date"
                />
              </label>
              <label className="field">
                <span>카테고리</span>
                <input name="category" placeholder="예: 유제품" />
              </label>
            </div>
            <button className="button button--primary button--full" type="submit">
              아이템 저장
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
