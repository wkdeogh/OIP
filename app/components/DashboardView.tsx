"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { UserCode } from "../oip-types";
import type { OipDataSnapshot } from "../../lib/client-data-cache";
import { calendarDateKey } from "../../lib/calendar-recurrence";
import { buildDashboardData, dashboardDaysUntil } from "../../lib/dashboard-data";
import type { DashboardSyncState } from "../../lib/dashboard-sync";

type Feature = "schedule" | "tasks" | "travel" | "fridge" | "parking";
const NAMES = { daeho: "대호", sanghee: "상희", system: "기념일" };
const dateFormatter = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "long", day: "numeric", weekday: "long" });
const timeFormatter = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const weekdayFormatter = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", weekday: "short" });

function shortDate(value: string) {
  const [, month, day] = calendarDateKey(value).split("-").map(Number);
  return `${month}.${day}`;
}

function deadlineLabel(value: string, today: string) {
  const days = dashboardDaysUntil(value, today);
  return days < 0 ? `${-days}일 지남` : days === 0 ? "오늘" : `D-${days}`;
}

function DashboardPanel({ id, title, summary, children, onOpen }: {
  id: Feature; title: string; summary?: string; children: ReactNode; onOpen: (feature: Feature) => void;
}) {
  return (
    <section aria-labelledby={`dashboard-${id}-title`} className={`dashboard-panel dashboard-panel--${id}`}>
      <header className="dashboard-panel-header">
        <h2 id={`dashboard-${id}-title`}><button onClick={() => onOpen(id)} type="button">
          {title}<span aria-hidden="true">↗</span>
        </button></h2>
        {summary ? <span className="dashboard-panel-summary">{summary}</span> : null}
      </header>
      <div className="dashboard-panel-body" tabIndex={0} role="region" aria-label={`${title} 내용`}>{children}</div>
    </section>
  );
}

export function DashboardView({ data, currentUser, syncState, lastSyncedAt, isLoading, theme, onToggleTheme, onOpen, onChangeUser, onYearChange }: {
  data: OipDataSnapshot;
  currentUser: UserCode;
  syncState: DashboardSyncState;
  lastSyncedAt: number | null;
  isLoading: boolean;
  theme: "light" | "dark";
  onToggleTheme: () => void;
  onOpen: (feature: Feature) => void;
  onChangeUser: () => void;
  onYearChange: (year: number) => void;
}) {
  const [now, setNow] = useState(() => new Date());
  const [online, setOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine !== false);
  const [wakeState, setWakeState] = useState<"requesting" | "active" | "released" | "unsupported">(() => typeof navigator !== "undefined" && "wakeLock" in navigator ? "requesting" : "unsupported");
  const [wakeAttempt, setWakeAttempt] = useState(0);
  const [fullscreenSupported] = useState(() => typeof document !== "undefined" && Boolean(document.fullscreenEnabled && document.documentElement.requestFullscreen));
  const [fullscreen, setFullscreen] = useState(false);
  const [displayError, setDisplayError] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const today = calendarDateKey(now.toISOString());
  const model = useMemo(() => buildDashboardData(data, today, currentUser), [data, today, currentUser]);

  useEffect(() => {
    const update = () => { setNow(new Date()); setOnline(navigator.onLine); };
    const timer = window.setInterval(update, 1000);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    window.addEventListener("pageshow", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
      window.removeEventListener("pageshow", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);

  useEffect(() => { onYearChange(model.year); }, [model.year, onYearChange]);

  useEffect(() => {
    if (!("wakeLock" in navigator)) return;
    let active = true;
    let pending = false;
    let lock: WakeLockSentinel | null = null;
    const request = async () => {
      if (!active || pending || (lock && !lock.released) || document.visibilityState === "hidden") return;
      pending = true;
      try {
        const next = await navigator.wakeLock.request("screen");
        if (!active) { await next.release(); return; }
        lock = next;
        setWakeState("active");
        next.addEventListener("release", () => { if (active) setWakeState("released"); });
      } catch {
        if (active) setWakeState("released");
      } finally { pending = false; }
    };
    void request();
    document.addEventListener("visibilitychange", request);
    window.addEventListener("pageshow", request);
    return () => {
      active = false;
      document.removeEventListener("visibilitychange", request);
      window.removeEventListener("pageshow", request);
      void lock?.release().catch(() => undefined);
    };
  }, [wakeAttempt]);

  useEffect(() => {
    const update = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", update);
    return () => {
      document.removeEventListener("fullscreenchange", update);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    };
  }, []);

  async function toggleFullscreen() {
    try {
      setDisplayError("");
      if (document.fullscreenElement) await document.exitFullscreen();
      else await rootRef.current?.requestFullscreen();
    } catch { setDisplayError("전체 화면을 켜지 못했어요."); }
  }

  const stale = lastSyncedAt !== null && now.getTime() - lastSyncedAt > 30_000;
  const delayed = syncState === "delayed" || stale;
  const status = !online ? "연결 끊김 · 재연결 대기" : delayed ? "갱신 지연 · 재시도 중" : syncState === "connecting" ? "연결 중" : "자동 갱신 중";
  const parking = model.parking;

  return (
    <div className="dashboard" ref={rootRef}>
      <header className="dashboard-header">
        <div className="dashboard-heading"><span className="dashboard-wordmark">OIP</span><h1>대시보드</h1></div>
        <div className="dashboard-clock"><time dateTime={today}>{dateFormatter.format(now)}</time><strong>{timeFormatter.format(now)}</strong></div>
        <div className="dashboard-actions">
          <button aria-label={`현재 사용자 ${NAMES[currentUser]}, 사용자 변경`} onClick={onChangeUser} type="button">{NAMES[currentUser]}</button>
          <button aria-label={theme === "dark" ? "밝은 테마" : "어두운 테마"} onClick={onToggleTheme} type="button">{theme === "dark" ? "라이트" : "다크"}</button>
          {fullscreenSupported ? <button onClick={toggleFullscreen} type="button">{fullscreen ? "전체 화면 해제" : "전체 화면"}</button> : null}
          <button onClick={() => onOpen("schedule")} type="button">앱으로</button>
        </div>
      </header>

      <main className="dashboard-grid" aria-busy={isLoading}>
        <DashboardPanel id="schedule" title="일정" summary={`${model.month}월`} onOpen={onOpen}>
          <div className="dashboard-calendar">
            <div className="dashboard-month" role="table" aria-label={`${model.year}년 ${model.month}월 일정`}>
              <div className="dashboard-week" role="row">{"일월화수목금토".split("").map((name) => <span role="columnheader" key={name}>{name}</span>)}</div>
              {Array.from({ length: 6 }, (_, week) => (
                <div className="dashboard-week" role="row" key={week}>
                  {model.monthDays.slice(week * 7, week * 7 + 7).map((day, index) => (
                    <div role="cell" aria-current={day.key === today ? "date" : undefined} aria-label={`${day.key}${day.events.length ? `, 일정 ${day.events.length}개` : ""}${day.holidays.map((item) => `, ${item.name}`).join("")}${day.daysOff.map((item) => `, ${NAMES[item.owner_id]} ${item.day_off_type}`).join("")}`} className={`dashboard-day${day.key.slice(0, 7) !== today.slice(0, 7) ? " is-outside" : ""}${day.key === today ? " is-today" : ""}${index === 0 || day.holidays.some((item) => item.is_holiday) ? " is-holiday" : ""}`} key={day.key}>
                      <span>{Number(day.key.slice(-2))}</span>
                      <div className="dashboard-day-marks" aria-hidden="true">{day.events.length ? <i /> : null}{day.daysOff.some((item) => item.owner_id === "daeho") ? <b className="dashboard-owner--daeho">대</b> : null}{day.daysOff.some((item) => item.owner_id === "sanghee") ? <b className="dashboard-owner--sanghee">상</b> : null}</div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
            <div className="dashboard-agenda">
              {model.agenda.map((day) => (
                <div className="dashboard-agenda-day" key={day.key}>
                  <h3>{day.key === today ? "오늘" : `${shortDate(day.key)} ${weekdayFormatter.format(new Date(`${day.key}T12:00:00+09:00`))}`}</h3>
                  {day.holidays.map((item) => <p className="dashboard-holiday" key={item.name}>{item.name}</p>)}
                  {day.daysOff.map((item) => <p className={`dashboard-owner--${item.owner_id}`} key={item.id}>{NAMES[item.owner_id]} · {item.day_off_type}{item.half_day_period ? item.half_day_period === "am" ? " (오전)" : " (오후)" : ""}</p>)}
                  {day.events.map((event) => (
                    <div className="dashboard-event" key={event.id}>
                      <span>{event.is_all_day ? "하루 종일" : calendarDateKey(event.start_at) < day.key ? "진행 중" : timeFormatter.format(new Date(event.start_at))}</span>
                      <div><strong>{event.title}</strong><small>{event.author_id === "system" ? "기념일" : event.visibility === "private" ? `${NAMES[event.author_id]} · 나만 보기` : event.color_mode === "custom" ? NAMES[event.author_id] : "공동"}{event.end_at && calendarDateKey(event.end_at) > day.key ? ` · ${shortDate(event.end_at)}까지` : ""}</small></div>
                    </div>
                  ))}
                  {!day.events.length && !day.daysOff.length && !day.holidays.length ? <p className="dashboard-empty">오늘은 예정된 일정이 없어요</p> : null}
                </div>
              ))}
            </div>
          </div>
        </DashboardPanel>

        <DashboardPanel id="tasks" title="할 일 · 쇼핑" summary={`${model.todos.length + model.shopping.length}개 남음`} onOpen={onOpen}>
          <div className="dashboard-task-columns">
            <div><h3>TODO <span>{model.todos.length}</span></h3>
              {model.overdueTodos ? <p className="dashboard-alert">기한 지난 할 일 {model.overdueTodos}개</p> : null}
              <ul className="dashboard-list">{model.todos.map((item) => <li key={item.id}><strong>{item.title}</strong><small className={item.due_at && calendarDateKey(item.due_at) < today ? "dashboard-alert" : ""}>{item.due_at ? `${shortDate(item.due_at)} · ${deadlineLabel(item.due_at, today)}` : "기한 없음"}{item.visibility === "private" ? ` · ${NAMES[item.author_id]}` : ""}</small></li>)}</ul>
              {!model.todos.length ? <p className="dashboard-empty">할 일을 모두 마쳤어요</p> : null}
            </div>
            <div><h3>쇼핑 <span>{model.shopping.length}</span></h3>
              <ul className="dashboard-list">{model.shopping.map((item) => <li key={item.id}><strong>{item.name}</strong><small>{item.quantity}{item.unit ?? "개"}</small></li>)}</ul>
              {!model.shopping.length ? <p className="dashboard-empty">살 물건이 없어요</p> : null}
            </div>
          </div>
        </DashboardPanel>

        <DashboardPanel id="travel" title="여행" summary={`예정 ${model.trips.length}`} onOpen={onOpen}>
          {model.trips.length ? model.trips.map((trip) => <div className="dashboard-trip" key={trip.id}>
            <span className="dashboard-countdown">{trip.start_date <= today ? "여행 중" : deadlineLabel(trip.start_date, today)}</span>
            <h3>{trip.title}</h3><p>{trip.destination}</p><small>{shortDate(trip.start_date)} — {shortDate(trip.end_date)}</small>
          </div>) : <p className="dashboard-empty">예정된 여행이 없어요</p>}
          <div className="dashboard-wishlist"><h3>가고 싶은 곳 <span>{model.wishlist.length}</span></h3>
            <div className="dashboard-wish-tags">{model.wishlist.map((item) => <span key={item.id}>{item.name}</span>)}</div>
            {!model.wishlist.length ? <p className="dashboard-empty">저장한 장소가 없어요</p> : null}
          </div>
        </DashboardPanel>

        <DashboardPanel id="fridge" title="냉장고" summary={model.urgentFridge ? `기한 확인 ${model.urgentFridge}개` : `${model.fridge.length}개 보관 중`} onOpen={onOpen}>
          <ul className="dashboard-list dashboard-fridge-list">{model.fridge.map((item) => {
            const days = dashboardDaysUntil(item.expiration_date, today);
            return <li key={item.id}><div><strong>{item.name}</strong><small>{item.storage_type} · {item.quantity}{item.unit ?? "개"} · {shortDate(item.expiration_date)}까지</small></div><span className={`dashboard-expiry${days <= 3 ? " is-urgent" : ""}`}>{days < 0 ? `${-days}일 지남` : days === 0 ? "오늘까지" : `${days}일 남음`}</span></li>;
          })}</ul>
          {!model.fridge.length ? <p className="dashboard-empty">보관 중인 식품이 없어요</p> : null}
        </DashboardPanel>

        <DashboardPanel id="parking" title="주차장" summary="현재 주차 위치" onOpen={onOpen}>
          {parking ? <div className="dashboard-parking-location"><span className="dashboard-parking-sign" aria-hidden="true">P</span>
            <strong className={parking.custom_location ? "is-custom" : ""}>{parking.custom_location || <>{parking.floor}<span>{parking.pillar_letter}{parking.pillar_number}</span></>}</strong>
            <small>{NAMES[parking.author_id]} · {shortDate(parking.created_at)} {timeFormatter.format(new Date(parking.created_at))} 저장</small>
          </div> : <p className="dashboard-empty">아직 저장된 주차 위치가 없어요</p>}
        </DashboardPanel>
      </main>

      <footer className="dashboard-footer">
        <div className={`dashboard-sync${!online || delayed ? " is-delayed" : ""}`} role="status"><i aria-hidden="true" />{isLoading ? "데이터 불러오는 중" : status}{lastSyncedAt ? <span>마지막 갱신 {timeFormatter.format(lastSyncedAt)}</span> : null}</div>
        {displayError ? <span role="status">{displayError}</span> : null}
        <button className="dashboard-wake" disabled={wakeState === "unsupported" || wakeState === "active"} onClick={() => setWakeAttempt((value) => value + 1)} title={wakeState === "unsupported" ? "이 기기는 설정에서 자동 잠금을 꺼 주세요." : undefined} type="button">
          {wakeState === "active" ? "화면 켜짐 유지 중" : wakeState === "unsupported" ? "자동 잠금은 기기 설정에서 해제" : wakeState === "requesting" ? "화면 유지 연결 중" : "화면 켜짐 유지 다시 켜기"}
        </button>
      </footer>
    </div>
  );
}
