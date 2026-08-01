"use client";

import {
  FormEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
  memo,
  startTransition,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal, flushSync } from "react-dom";
import { SYSTEM_ANNIVERSARIES } from "@/lib/calendar-reminders";
import {
  clearOipDataCache,
  readOipDataCache,
  readOipDataCacheSync,
  type OipDataSnapshot,
  writeOipDataCache,
} from "@/lib/client-data-cache";
import type {
  CalendarColorDefaults,
  CalendarColorSettings,
  CalendarDayBackground,
  CalendarEvent,
  DayOff,
  FridgeItem,
  ParkingRecord,
  PublicHoliday,
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

type MainTab =
  | "schedule"
  | "tasks"
  | "travel"
  | "fridge"
  | "parking";
type TaskTab = "todo" | "shopping";
type ThemeMode = "light" | "dark";
type PushStatus =
  | "checking"
  | "unsupported"
  | "unconfigured"
  | "disabled"
  | "denied"
  | "enabled"
  | "loading";
type ModalName =
  | "event"
  | "dayoff"
  | "day-background"
  | "trip"
  | "fridge"
  | null;
type DateRange = { start: string; end: string };
type CalendarEventScope = "shared" | "personal" | "private";
type DateRangeSelection = "start" | "end";
type TripSection =
  | "overview"
  | "trip_flights"
  | "trip_accommodations"
  | "trip_transportations"
  | "trip_foods"
  | "trip_places"
  | "trip_checklist"
  | "trip_notepad";
type TripDetailResource = Exclude<
  TripSection,
  "overview" | "trip_checklist" | "trip_notepad"
>;
type TripDetailItem =
  | TripFlight
  | TripAccommodation
  | TripTransportation
  | TripFood
  | TripPlace;
type TripChecklistItem = {
  id: string;
  title: string;
  is_checked: boolean;
};

function retainEquivalentValue<T>(current: T, next: T) {
  if (current === next) return current;
  try {
    return JSON.stringify(current) === JSON.stringify(next) ? current : next;
  } catch {
    return next;
  }
}

const USER_META: Record<
  UserCode,
  { name: string; short: string; color: string }
> = {
  daeho: { name: "대호", short: "대", color: "#34c77b" },
  sanghee: { name: "상희", short: "상", color: "#ff829b" },
};

/*
 * 이전 9색 팔레트 복원용 (기본색 포함)
 * 기본색 "", 노랑 #EBC44F, 파랑 #7FC1EB, 초록 #82CE99,
 * 보라 #B596DE, 분홍 #EC91A5, 주황 #EFA966, 코랄 #EB7F78,
 * 회색 #AEB8C4
 */
const EVENT_COLOR_OPTIONS = [
  { name: "노랑", value: "#FFC928" },
  { name: "라임", value: "#D7DC45" },
  { name: "초록", value: "#65D13F" },
  { name: "연녹", value: "#34C77B" },
  { name: "민트", value: "#20C7A5" },
  { name: "청록", value: "#08B59C" },
  { name: "하늘", value: "#42A5E9" },
  { name: "파랑", value: "#4285F4" },
  { name: "남색", value: "#5A72DB" },
  { name: "보라", value: "#9C6ADE" },
  { name: "연보라", value: "#B978D0" },
  { name: "분홍", value: "#EC5F91" },
  { name: "연분홍", value: "#FF829B" },
  { name: "코랄", value: "#FF675E" },
  { name: "빨강", value: "#FF3045" },
  { name: "와인", value: "#C83C68" },
  { name: "주황", value: "#FF9D19" },
  { name: "브라운", value: "#B8774B" },
  { name: "회색", value: "#819DB9" },
  { name: "차콜", value: "#53665F" },
] as const;

type CalendarColorDefaultKey = keyof CalendarColorDefaults;

const FALLBACK_CALENDAR_COLOR_DEFAULTS: CalendarColorDefaults = {
  daeho: "#34C77B",
  sanghee: "#FF829B",
  shared: "#FFC928",
  private: "#9C6ADE",
};
const DARK_EVENT_TEXT_COLORS = new Set(["#FFC928", "#D7DC45"]);

function eventTextColor(backgroundColor: string) {
  return DARK_EVENT_TEXT_COLORS.has(backgroundColor.toUpperCase())
    ? "#1a1a1a"
    : "#ffffff";
}

const CALENDAR_COLOR_DEFAULT_OPTIONS: Array<{
  key: CalendarColorDefaultKey;
  label: string;
}> = [
  { key: "daeho", label: "대호 개인일정" },
  { key: "sanghee", label: "상희 개인일정" },
  { key: "shared", label: "공동일정" },
  { key: "private", label: "나만보기" },
];

function validCalendarColor(value: unknown, fallback: string) {
  if (typeof value !== "string" || !/^#[0-9A-Fa-f]{6}$/.test(value)) {
    return fallback;
  }
  const normalized = value.toUpperCase();
  return LEGACY_EVENT_COLOR_DISPLAY[normalized] ?? normalized;
}

function calendarColorDefaultsFromSettings(
  settings?: Partial<CalendarColorSettings> | null,
): CalendarColorDefaults {
  return {
    daeho: validCalendarColor(
      settings?.daeho_color,
      FALLBACK_CALENDAR_COLOR_DEFAULTS.daeho,
    ),
    sanghee: validCalendarColor(
      settings?.sanghee_color,
      FALLBACK_CALENDAR_COLOR_DEFAULTS.sanghee,
    ),
    shared: validCalendarColor(
      settings?.shared_color,
      FALLBACK_CALENDAR_COLOR_DEFAULTS.shared,
    ),
    private: validCalendarColor(
      settings?.private_color,
      FALLBACK_CALENDAR_COLOR_DEFAULTS.private,
    ),
  };
}

const COUNTRY_CODES = `
AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ
BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR
CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR
GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU
ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ
LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ
MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF
PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI
SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR
TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW
`
  .trim()
  .split(/\s+/);

const COUNTRY_SEARCH_ALIASES: Record<string, string> = {
  CN: "중국 차이나",
  DE: "독일 도이칠란트",
  ES: "스페인 에스파냐",
  GB: "영국 잉글랜드",
  GR: "그리스",
  IT: "이탈리아",
  JP: "일본 재팬",
  KR: "대한민국 한국 코리아",
  NL: "네덜란드",
  TH: "태국 타이",
  TW: "대만 타이완",
  US: "미국 아메리카",
  VN: "베트남",
};

const koreanRegionNames = new Intl.DisplayNames(["ko-KR"], { type: "region" });
const englishRegionNames = new Intl.DisplayNames(["en"], { type: "region" });

const COUNTRIES = COUNTRY_CODES.map((code) => ({
  code,
  name: koreanRegionNames.of(code) ?? code,
  englishName: englishRegionNames.of(code) ?? code,
})).sort((left, right) => left.name.localeCompare(right.name, "ko"));

function countryFlag(code?: string | null) {
  if (!code || !/^[A-Z]{2}$/.test(code)) return "🌏";
  return String.fromCodePoint(
    ...code.split("").map((letter) => 127397 + letter.charCodeAt(0)),
  );
}

function inferredCountryCode(destination: string) {
  const normalized = destination.toLocaleLowerCase("ko-KR");
  const destinationHints: Array<[string, string[]]> = [
    ["KR", ["대한민국", "한국", "제주", "서울", "부산"]],
    ["JP", ["일본", "교토", "도쿄", "오사카", "후쿠오카", "삿포로", "오키나와"]],
    ["US", ["미국", "뉴욕", "하와이", "괌", "사이판", "로스앤젤레스"]],
    ["CN", ["중국", "상하이", "베이징", "칭다오"]],
    ["TW", ["대만", "타이베이", "가오슝"]],
    ["TH", ["태국", "방콕", "치앙마이", "푸켓"]],
    ["VN", ["베트남", "다낭", "하노이", "호치민", "나트랑"]],
    ["FR", ["프랑스", "파리", "니스"]],
    ["IT", ["이탈리아", "로마", "밀라노", "피렌체", "베네치아"]],
    ["ES", ["스페인", "바르셀로나", "마드리드"]],
    ["GB", ["영국", "런던"]],
    ["DE", ["독일", "베를린", "뮌헨"]],
    ["SG", ["싱가포르"]],
    ["PH", ["필리핀", "세부", "보라카이", "마닐라"]],
    ["ID", ["인도네시아", "발리"]],
    ["AU", ["호주", "시드니", "멜버른"]],
    ["CA", ["캐나다", "밴쿠버", "토론토"]],
  ];
  return destinationHints.find(([, hints]) =>
    hints.some((hint) => normalized.includes(hint.toLocaleLowerCase("ko-KR"))),
  )?.[0];
}

const TRIP_COUNTRY_MEMO_PATTERN = /^\[\[country:([A-Z]{2})\]\]\n?/m;
const TRIP_CHECKLIST_MEMO_PATTERN = /^\[\[checklist:([^\]]*)\]\]\n?/m;

function tripCountryCode(trip: Trip) {
  return (
    trip.country_code ??
    trip.memo?.match(TRIP_COUNTRY_MEMO_PATTERN)?.[1] ??
    inferredCountryCode(`${trip.title} ${trip.destination}`)
  );
}

function visibleTripMemo(memo?: string | null) {
  return (memo ?? "")
    .replace(TRIP_COUNTRY_MEMO_PATTERN, "")
    .replace(TRIP_CHECKLIST_MEMO_PATTERN, "")
    .trim();
}

function tripChecklistFromMemo(memo?: string | null): TripChecklistItem[] {
  const encoded = memo?.match(TRIP_CHECKLIST_MEMO_PATTERN)?.[1];
  if (!encoded) return [];
  try {
    const parsed = JSON.parse(decodeURIComponent(encoded)) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is TripChecklistItem =>
        typeof item === "object" &&
        item !== null &&
        typeof item.id === "string" &&
        typeof item.title === "string" &&
        typeof item.is_checked === "boolean",
    );
  } catch {
    return [];
  }
}

function composeTripMemo(
  memo: string | null | undefined,
  changes: {
    countryCode?: string | null;
    checklist?: TripChecklistItem[];
    visibleMemo?: string;
  },
) {
  const currentCountry = memo?.match(TRIP_COUNTRY_MEMO_PATTERN)?.[1] ?? null;
  const countryCode =
    changes.countryCode === undefined ? currentCountry : changes.countryCode;
  const checklist =
    changes.checklist === undefined ? tripChecklistFromMemo(memo) : changes.checklist;
  const note =
    changes.visibleMemo === undefined ? visibleTripMemo(memo) : changes.visibleMemo.trim();
  const metadata = [
    countryCode ? `[[country:${countryCode}]]` : "",
    checklist.length
      ? `[[checklist:${encodeURIComponent(JSON.stringify(checklist))}]]`
      : "",
  ].filter(Boolean);
  return [...metadata, note].filter(Boolean).join("\n");
}

function memoWithCountryCode(
  memo: string | null | undefined,
  countryCode: string,
) {
  return composeTripMemo(memo, { countryCode });
}

function memoWithChecklist(
  memo: string | null | undefined,
  checklist: TripChecklistItem[],
) {
  return composeTripMemo(memo, { checklist });
}

function memoWithVisibleText(memo: string | null | undefined, text: string) {
  return composeTripMemo(memo, { visibleMemo: text });
}

const DAY_BACKGROUND_OPTIONS = [
  { name: "기본", value: "" },
  { name: "노랑", value: "#F3D96B" },
  { name: "초록", value: "#83CFA0" },
  { name: "민트", value: "#75CFC2" },
  { name: "파랑", value: "#82BCE7" },
  { name: "보라", value: "#B49ADA" },
  { name: "분홍", value: "#ECA0B1" },
  { name: "주황", value: "#EFA66E" },
  { name: "회색", value: "#AEB8C4" },
] as const;

const LEGACY_EVENT_COLOR_DISPLAY: Record<string, string> = {
  "#F6D875": "#FFC928",
  "#EBC44F": "#FFC928",
  "#FFD43B": "#FFC928",
  "#B97800": "#FFC928",
  "#A9E34B": "#D7DC45",
  "#5C940D": "#D7DC45",
  "#A8DDB8": "#65D13F",
  "#82CE99": "#65D13F",
  "#40C057": "#65D13F",
  "#238636": "#65D13F",
  "#7FA99B": "#34C77B",
  "#12805C": "#34C77B",
  "#38D9A9": "#20C7A5",
  "#087F61": "#20C7A5",
  "#22B8CF": "#08B59C",
  "#087E8B": "#08B59C",
  "#4DABF7": "#42A5E9",
  "#1971C2": "#42A5E9",
  "#A8D5F2": "#4285F4",
  "#7FC1EB": "#4285F4",
  "#3B82F6": "#4285F4",
  "#2563EB": "#4285F4",
  "#4263EB": "#5A72DB",
  "#364FC7": "#5A72DB",
  "#CEB7EC": "#9C6ADE",
  "#B596DE": "#9C6ADE",
  "#845EF7": "#9C6ADE",
  "#7048E8": "#9C6ADE",
  "#B197FC": "#B978D0",
  "#7950F2": "#B978D0",
  "#F5B7C3": "#EC5F91",
  "#EC91A5": "#EC5F91",
  "#F06595": "#EC5F91",
  "#C2255C": "#EC5F91",
  "#E9A6AD": "#FF829B",
  "#D6336C": "#FF829B",
  "#F4A6A0": "#FF675E",
  "#EB7F78": "#FF675E",
  "#FF6B6B": "#FF675E",
  "#CF3F38": "#FF675E",
  "#F03E3E": "#FF3045",
  "#D92D20": "#FF3045",
  "#A61E4D": "#C83C68",
  "#F7C49A": "#FF9D19",
  "#EFA966": "#FF9D19",
  "#FF922B": "#FF9D19",
  "#C94F00": "#FF9D19",
  "#A66A3F": "#B8774B",
  "#9C5429": "#B8774B",
  "#CCD3DB": "#819DB9",
  "#AEB8C4": "#819DB9",
  "#98A2B3": "#819DB9",
  "#667085": "#819DB9",
  "#34413A": "#53665F",
};

const MAIN_TABS: Array<{
  id: MainTab;
  label: string;
  icon: string;
  title: string;
}> = [
  { id: "schedule", label: "일정", icon: "▦", title: "일정" },
  { id: "tasks", label: "할일", icon: "✓", title: "할일" },
  { id: "travel", label: "여행", icon: "✈", title: "여행" },
  { id: "fridge", label: "냉장고", icon: "□", title: "냉장고" },
  { id: "parking", label: "주차장", icon: "P", title: "주차장" },
];

function toDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function initialCalendarDate() {
  const today = toDateKey(new Date());
  if (typeof window === "undefined") return today;
  const requestedDate = new URLSearchParams(window.location.search).get("date");
  return requestedDate && /^\d{4}-\d{2}-\d{2}$/.test(requestedDate)
    ? requestedDate
    : today;
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

function dateKeysInRange(range: DateRange) {
  const normalized = normalizeRange(range.start, range.end);
  const cursor = parseDateKey(normalized.start);
  const end = parseDateKey(normalized.end);
  const dates: string[] = [];
  while (cursor <= end) {
    dates.push(toDateKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
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

function defaultEventColor(
  scope: CalendarEventScope,
  user: UserCode,
  defaults: CalendarColorDefaults,
) {
  if (scope === "shared") return defaults.shared;
  if (scope === "private") return defaults.private;
  return defaults[user];
}

function calendarColorDefaultKey(
  scope: CalendarEventScope,
  user: UserCode,
): CalendarColorDefaultKey {
  if (scope === "shared") return "shared";
  if (scope === "private") return "private";
  return user;
}

function displayedCustomEventColor(color?: string | null) {
  if (!color) return null;
  return LEGACY_EVENT_COLOR_DISPLAY[color.toUpperCase()] ?? color;
}

const eventChipFitCache = new Map<string, string>();

function eventLabelGraphemes(value: string) {
  if (typeof Intl.Segmenter === "function") {
    const segmenter = new Intl.Segmenter("ko", { granularity: "grapheme" });
    return Array.from(segmenter.segment(value), ({ segment }) => segment);
  }
  return Array.from(value);
}

function fitCalendarEventLabels(container: HTMLElement) {
  const labels = Array.from(
    container.querySelectorAll<HTMLElement>(".event-chip-label[data-full-text]"),
  );
  if (!labels.length) return;

  const context = document.createElement("canvas").getContext("2d");
  if (!context) return;

  labels.forEach((label) => {
    const fullText = label.dataset.fullText ?? "";
    const chip = label.closest<HTMLElement>(".event-chip");
    if (!chip) return;

    const style = window.getComputedStyle(chip);
    const labelStyle = window.getComputedStyle(label);
    const availableWidth = Math.max(
      0,
      label.clientWidth -
        Number.parseFloat(labelStyle.paddingLeft) -
        Number.parseFloat(labelStyle.paddingRight),
    );
    const font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const letterSpacing = Number.parseFloat(style.letterSpacing) || 0;
    const cacheKey = `${fullText}\u0000${Math.floor(availableWidth * 10)}\u0000${font}\u0000${letterSpacing}`;
    const cached = eventChipFitCache.get(cacheKey);
    if (cached !== undefined) {
      label.textContent = cached;
      return;
    }

    context.font = font;
    const graphemes = eventLabelGraphemes(fullText);
    let low = 0;
    let high = graphemes.length;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      const candidate = graphemes.slice(0, middle).join("");
      const candidateWidth =
        context.measureText(candidate).width +
        Math.max(0, middle - 1) * letterSpacing;
      if (candidateWidth <= availableWidth) {
        low = middle;
      } else {
        high = middle - 1;
      }
    }

    const fitted = graphemes.slice(0, low).join("");
    if (eventChipFitCache.size > 500) eventChipFitCache.clear();
    eventChipFitCache.set(cacheKey, fitted);
    label.textContent = fitted;
  });
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
          당신은 누구십니까?!?!?
          <br />
          비밀번호를 입력해 주세요.
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
  activeDefaultKey,
  defaultColors,
  value,
  onClose,
  onSaveDefaultColors,
  onSelect,
}: {
  activeDefaultKey: CalendarColorDefaultKey;
  defaultColors: CalendarColorDefaults;
  value: string;
  onClose: () => void;
  onSaveDefaultColors: (colors: CalendarColorDefaults) => Promise<boolean>;
  onSelect: (color: string) => void;
}) {
  const [view, setView] = useState<"colors" | "defaults">("colors");
  const [selectedDefaultKey, setSelectedDefaultKey] =
    useState<CalendarColorDefaultKey>(activeDefaultKey);
  const [draftDefaults, setDraftDefaults] = useState(defaultColors);
  const [isSavingDefaults, setIsSavingDefaults] = useState(false);

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
          <div className="event-color-picker-title">
            {view === "defaults" ? (
              <button
                aria-label="컬러 선택으로 돌아가기"
                className="event-color-picker-back"
                onClick={() => setView("colors")}
                type="button"
              >
                ‹
              </button>
            ) : null}
            <h3>{view === "colors" ? "컬러" : "기본색상 설정"}</h3>
            {view === "colors" ? (
              <button
                className="event-color-default-settings-trigger"
                onClick={() => setView("defaults")}
                type="button"
              >
                기본색상 설정
              </button>
            ) : null}
          </div>
          <button
            aria-label="컬러 선택 닫기"
            className="icon-button"
            onClick={onClose}
            type="button"
          >
            ×
          </button>
        </header>
        {view === "colors" ? (
          <div className="event-color-picker-options">
            {EVENT_COLOR_OPTIONS.map((option) => {
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
                    style={{
                      backgroundColor: option.value,
                      color: eventTextColor(option.value),
                      textShadow: DARK_EVENT_TEXT_COLORS.has(option.value)
                        ? "none"
                        : undefined,
                    }}
                  >
                    {option.name}
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="event-color-default-settings">
            <div className="event-color-default-targets">
              {CALENDAR_COLOR_DEFAULT_OPTIONS.map((option) => (
                <button
                  aria-pressed={selectedDefaultKey === option.key}
                  className={
                    selectedDefaultKey === option.key ? "is-selected" : ""
                  }
                  key={option.key}
                  onClick={() => setSelectedDefaultKey(option.key)}
                  type="button"
                >
                  <span
                    aria-hidden="true"
                    style={{ backgroundColor: draftDefaults[option.key] }}
                  />
                  {option.label}
                </button>
              ))}
            </div>
            <p className="event-color-default-help">
              {
                CALENDAR_COLOR_DEFAULT_OPTIONS.find(
                  (option) => option.key === selectedDefaultKey,
                )?.label
              } 색상
            </p>
            <div className="event-color-picker-options event-color-picker-options--defaults">
              {EVENT_COLOR_OPTIONS.map((option) => {
                const isSelected =
                  draftDefaults[selectedDefaultKey] === option.value;
                return (
                  <button
                    aria-label={`${option.name}, 기본색상으로 선택`}
                    aria-pressed={isSelected}
                    className={isSelected ? "is-selected" : ""}
                    key={option.name}
                    onClick={() =>
                      setDraftDefaults((current) => ({
                        ...current,
                        [selectedDefaultKey]: option.value,
                      }))
                    }
                    type="button"
                  >
                    <span
                      className="event-color-picker-swatch"
                      style={{
                        backgroundColor: option.value,
                        color: eventTextColor(option.value),
                        textShadow: DARK_EVENT_TEXT_COLORS.has(option.value)
                          ? "none"
                          : undefined,
                      }}
                    >
                      {option.name}
                    </span>
                  </button>
                );
              })}
            </div>
            <button
              className="button button--primary button--full event-color-default-save"
              disabled={isSavingDefaults}
              onClick={async () => {
                setIsSavingDefaults(true);
                const saved = await onSaveDefaultColors(draftDefaults);
                setIsSavingDefaults(false);
                if (saved) onClose();
              }}
              type="button"
            >
              {isSavingDefaults ? "저장 중…" : "기본색상 저장"}
            </button>
          </div>
        )}
      </section>
    </div>,
    document.body,
  );
}

function EventForm({
  colorDefaults,
  currentUser,
  initialEvent,
  initialRange,
  scope,
  onSaveDefaultColors,
  onSubmit,
}: {
  colorDefaults: CalendarColorDefaults;
  currentUser: UserCode;
  initialEvent?: CalendarEvent | null;
  initialRange: DateRange;
  scope: CalendarEventScope;
  onSaveDefaultColors: (colors: CalendarColorDefaults) => Promise<boolean>;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const [range, setRange] = useState(
    initialEvent ? eventDateRange(initialEvent) : initialRange,
  );
  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);
  const [isColorPickerOpen, setIsColorPickerOpen] = useState(false);
  const [hasTime, setHasTime] = useState(
    initialEvent ? !initialEvent.is_all_day : false,
  );
  const initialStartTime =
    initialEvent && !initialEvent.is_all_day
      ? timeInSeoul(initialEvent.start_at)
      : "09:00";
  const [startTime, setStartTime] = useState(initialStartTime);
  const [endTime, setEndTime] = useState(
    initialEvent?.end_at && !initialEvent.is_all_day
      ? timeInSeoul(initialEvent.end_at)
      : addOneHour(initialStartTime),
  );
  const baseColor = defaultEventColor(scope, currentUser, colorDefaults);
  const [usesDefaultColor, setUsesDefaultColor] = useState(
    !initialEvent?.custom_color,
  );
  const [color, setColor] = useState(
    displayedCustomEventColor(initialEvent?.custom_color) ?? baseColor,
  );
  const displayedColor = usesDefaultColor
    ? baseColor
    : (displayedCustomEventColor(color) ?? color);
  const selectedColorName =
    EVENT_COLOR_OPTIONS.find((option) => option.value === displayedColor)?.name ??
    "선택 색상";

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
            defaultValue={initialEvent?.title ?? ""}
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
        <input
          name="custom_color"
          readOnly
          type="hidden"
          value={usesDefaultColor ? "" : color}
        />

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
              backgroundColor: displayedColor || baseColor,
              color: eventTextColor(displayedColor || baseColor),
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
          {initialEvent ? "수정 저장" : "일정 저장"}
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
          activeDefaultKey={calendarColorDefaultKey(scope, currentUser)}
          defaultColors={colorDefaults}
          onClose={() => setIsColorPickerOpen(false)}
          onSaveDefaultColors={onSaveDefaultColors}
          onSelect={(nextColor) => {
            setColor(nextColor);
            setUsesDefaultColor(
              nextColor.toUpperCase() === baseColor.toUpperCase(),
            );
          }}
          value={displayedColor}
        />
      ) : null}
    </>
  );
}

function DayBackgroundForm({
  initialColor,
  onSubmit,
  range,
}: {
  initialColor: string;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  range: DateRange;
}) {
  const [color, setColor] = useState(initialColor);
  return (
    <form className="modal-form" onSubmit={onSubmit}>
      <p className="day-background-range">{formatEventDateSummary(range)}</p>
      <input name="background_color" readOnly type="hidden" value={color} />
      <div className="day-background-options">
        {DAY_BACKGROUND_OPTIONS.map((option) => {
          const selected = color === option.value;
          return (
            <button
              aria-label={`${option.name} 배경${selected ? ", 선택됨" : ""}`}
              aria-pressed={selected}
              className={`day-background-option${selected ? " is-selected" : ""}`}
              key={option.name}
              onClick={() => setColor(option.value)}
              type="button"
            >
              <span
                className={option.value ? "" : "is-default"}
                style={
                  option.value
                    ? { backgroundColor: option.value }
                    : undefined
                }
              >
                {selected ? "✓" : ""}
              </span>
              <small>{option.name}</small>
            </button>
          );
        })}
      </div>
      <button className="button button--primary button--full" type="submit">
        배경 저장
      </button>
    </form>
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
  colorDefaults,
  date,
  events,
  daysOff,
  holidays,
  onAddDayOff,
  onAddEvent,
  onClose,
  onDeleteDayOff,
  onDeleteEvent,
  onEditEvent,
  onSetBackground,
}: {
  colorDefaults: CalendarColorDefaults;
  date: string;
  events: CalendarEvent[];
  daysOff: DayOff[];
  holidays: PublicHoliday[];
  onAddDayOff: () => void;
  onAddEvent: () => void;
  onClose: () => void;
  onDeleteDayOff: (item: DayOff) => void;
  onDeleteEvent: (event: CalendarEvent) => void;
  onEditEvent: (event: CalendarEvent) => void;
  onSetBackground: () => void;
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
              onSetBackground();
            }}
            type="button"
          >
            배경색
          </button>
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
                      style={{
                        backgroundColor:
                          displayedCustomEventColor(event.custom_color) ??
                          defaultEventColor(
                            calendarEventScope(event),
                            event.author_id === "sanghee" ? "sanghee" : "daeho",
                            colorDefaults,
                          ),
                      }}
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
                    <div className="detail-row-actions">
                      <button
                        aria-label={`${event.title} 일정 수정`}
                        className="row-edit"
                        onClick={() => {
                          onClose();
                          onEditEvent(event);
                        }}
                        type="button"
                      >
                        ✎
                      </button>
                      <button
                        aria-label={`${event.title} 일정 삭제`}
                        className="row-delete"
                        onClick={() => onDeleteEvent(event)}
                        type="button"
                      >
                        ×
                      </button>
                    </div>
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

function CalendarRangeSheet({
  onAddDayOff,
  onAddEvent,
  onClose,
  onSetBackground,
  range,
}: {
  onAddDayOff: () => void;
  onAddEvent: () => void;
  onClose: () => void;
  onSetBackground: () => void;
  range: DateRange;
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

  const count = dateKeysInRange(range).length;
  return (
    <div
      className="day-sheet-backdrop"
      onMouseDown={onClose}
      role="presentation"
    >
      <section
        aria-labelledby="range-sheet-title"
        aria-modal="true"
        className="day-sheet range-action-sheet"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="day-sheet-handle" aria-hidden="true" />
        <header className="day-sheet-head">
          <div>
            <h2 id="range-sheet-title">{count}일 선택</h2>
            <p>{formatEventDateSummary(range)}</p>
          </div>
          <button
            aria-label="여러 날짜 선택 닫기"
            className="icon-button"
            onClick={onClose}
            type="button"
          >
            ×
          </button>
        </header>
        <div className="range-action-buttons">
          <button
            className="button button--primary"
            onClick={onAddEvent}
            type="button"
          >
            + 일정
          </button>
          <button
            className="button button--soft"
            onClick={onAddDayOff}
            type="button"
          >
            휴무
          </button>
          <button
            className="button button--soft"
            onClick={onSetBackground}
            type="button"
          >
            배경색
          </button>
        </div>
      </section>
    </div>
  );
}

const CalendarMonthGrid = memo(function CalendarMonthGrid({
  backgroundByDate,
  colorDefaults,
  daysOff,
  events,
  holidays,
  monthIndex,
  selectedRange,
  year,
}: {
  backgroundByDate: Map<string, CalendarDayBackground>;
  colorDefaults: CalendarColorDefaults;
  daysOff: DayOff[];
  events: CalendarEvent[];
  holidays: PublicHoliday[];
  monthIndex: number;
  selectedRange: DateRange | null;
  year: number;
}) {
  const panelMonth = useMemo(
    () => new Date(year, monthIndex, 1),
    [monthIndex, year],
  );
  const panelDays = useMemo(
    () => monthCalendarDays(panelMonth),
    [panelMonth],
  );
  const panelSystemEvents = useMemo<CalendarEvent[]>(
    () =>
      SYSTEM_ANNIVERSARIES.map(({ day, title }) => ({
        id: `system-${year}-${day}`,
        title,
        start_at: `${year}-${day}T00:00:00+09:00`,
        is_all_day: true,
        visibility: "shared" as const,
        author_id: "system" as const,
        event_type: "anniversary" as const,
      })),
    [year],
  );
  const panelEvents = useMemo(
    () => [...events, ...panelSystemEvents],
    [events, panelSystemEvents],
  );
  const panelEventLanes = useMemo(
    () => buildCalendarEventLanes(panelEvents, panelDays),
    [panelDays, panelEvents],
  );
  const panelHolidayWeekIndexes = useMemo(() => {
    const panelDayIndexes = new Map(
      panelDays.map((date, index) => [toDateKey(date), index]),
    );
    const result = new Set<number>();
    holidays.forEach((holiday) => {
      if (!holiday.is_holiday) return;
      const dayIndex = panelDayIndexes.get(holiday.date);
      if (dayIndex !== undefined) result.add(Math.floor(dayIndex / 7));
    });
    return result;
  }, [holidays, panelDays]);
  const panelEventsByDate = useMemo(() => {
    const result = new Map<
      string,
      Array<{ event: CalendarEvent; lane: number }>
    >();
    const panelDayKeys = panelDays.map(toDateKey);
    events.forEach((event) => {
      if (event.event_type === "anniversary") return;
      const range = eventDateRange(event);
      panelDayKeys.forEach((dateKey, dayIndex) => {
        if (dateKey < range.start || dateKey > range.end) return;
        const weekIndex = Math.floor(dayIndex / 7);
        const dateEvents = result.get(dateKey) ?? [];
        dateEvents.push({
          event,
          lane:
            panelEventLanes.get(calendarEventLaneKey(weekIndex, event.id)) ?? 0,
        });
        result.set(dateKey, dateEvents);
      });
    });
    result.forEach((dateEvents) => {
      dateEvents.sort(
        (left, right) =>
          left.lane - right.lane ||
          left.event.start_at.localeCompare(right.event.start_at),
      );
    });
    return result;
  }, [events, panelDays, panelEventLanes]);
  const panelAnniversariesByDate = useMemo(() => {
    const result = new Map<string, CalendarEvent[]>();
    panelSystemEvents.forEach((event) => {
      const dateKey = eventDateRange(event).start;
      const dateEvents = result.get(dateKey) ?? [];
      dateEvents.push(event);
      result.set(dateKey, dateEvents);
    });
    return result;
  }, [panelSystemEvents]);
  const panelHolidaysByDate = useMemo(() => {
    const result = new Map<string, PublicHoliday[]>();
    holidays.forEach((holiday) => {
      if (!holiday.is_holiday) return;
      const dateHolidays = result.get(holiday.date) ?? [];
      dateHolidays.push(holiday);
      result.set(holiday.date, dateHolidays);
    });
    return result;
  }, [holidays]);
  const panelDaysOffByDate = useMemo(() => {
    const result = new Map<string, DayOff[]>();
    daysOff.forEach((item) => {
      const dateDaysOff = result.get(item.date) ?? [];
      dateDaysOff.push(item);
      result.set(item.date, dateDaysOff);
    });
    return result;
  }, [daysOff]);
  const calendarGridRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const grid = calendarGridRef.current;
    if (!grid) return;

    fitCalendarEventLabels(grid);
    let resizeFrame: number | null = null;
    const observer = new ResizeObserver(() => {
      if (resizeFrame !== null) return;
      resizeFrame = window.requestAnimationFrame(() => {
        resizeFrame = null;
        fitCalendarEventLabels(grid);
      });
    });
    observer.observe(grid);

    return () => {
      observer.disconnect();
      if (resizeFrame !== null) window.cancelAnimationFrame(resizeFrame);
    };
  }, [panelEventsByDate]);
  const todayKey = toDateKey(new Date());

  return (
    <div className="calendar-grid" ref={calendarGridRef}>
      {panelDays.map((date, dayIndex) => {
        const key = toDateKey(date);
        const weekIndex = Math.floor(dayIndex / 7);
        const weekHasHoliday = panelHolidayWeekIndexes.has(weekIndex);
        const dateEvents = panelEventsByDate.get(key) ?? [];
        const hiddenEventCount = dateEvents.filter(
          ({ lane }) => lane >= 3,
        ).length;
        const dateAnniversaries = panelAnniversariesByDate.get(key) ?? [];
        const dateHolidays = panelHolidaysByDate.get(key) ?? [];
        const dateDaysOff = panelDaysOffByDate.get(key) ?? [];
        const dateBackground = backgroundByDate.get(key);
        const owners = new Set(dateDaysOff.map((item) => item.owner_id));
        const dayOffBackground =
          owners.size === 2
            ? "color-mix(in srgb, rgb(233 166 173) 15%, var(--surface))"
            : owners.has("daeho")
              ? "rgba(127,169,155,.15)"
              : owners.has("sanghee")
                ? "rgba(233,166,173,.15)"
                : undefined;
        const background = dateBackground
          ? `color-mix(in srgb, ${dateBackground.background_color} 42%, var(--surface))`
          : dayOffBackground;
        const isRangeSelected =
          selectedRange &&
          key >= selectedRange.start &&
          key <= selectedRange.end;
        const isOutside = date.getMonth() !== monthIndex;
        const isToday = key === todayKey;
        const hasSplitDayOffBackground = owners.size === 2 && !dateBackground;

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
              hasSplitDayOffBackground
                ? "calendar-day--split-day-off"
                : "",
              isRangeSelected ? "calendar-day--range-selected" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            data-calendar-date={key}
            key={key}
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
                  const customColor = displayedCustomEventColor(
                    event.custom_color,
                  );
                  const resolvedColor =
                    customColor ??
                    defaultEventColor(
                      calendarEventScope(event),
                      event.author_id === "sanghee" ? "sanghee" : "daeho",
                      colorDefaults,
                    );
                  const isRange = range.start !== range.end;
                  const isSegmentStart =
                    isRange && (range.start === key || date.getDay() === 0);
                  const isSegmentEnd =
                    isRange && (range.end === key || date.getDay() === 6);
                  const showTitle = !isRange || isSegmentStart;
                  const showTimeIndicator = showTitle && !event.is_all_day;
                  const chipText = showTitle ? event.title : "\u00a0";

                  return (
                    <span
                      className={[
                        "event-chip",
                        `event-chip--${calendarEventColor(event)}`,
                        isRange ? "event-chip--range" : "",
                        isSegmentStart ? "event-chip--segment-start" : "",
                        isSegmentEnd ? "event-chip--segment-end" : "",
                        showTimeIndicator ? "event-chip--timed" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      key={event.id}
                      style={{
                        gridRow: lane + 1,
                        backgroundColor: resolvedColor,
                        color: eventTextColor(resolvedColor),
                      }}
                    >
                      {showTimeIndicator ? (
                        <span
                          aria-hidden="true"
                          className="event-chip-time-dot"
                        />
                      ) : null}
                      <span
                        className="event-chip-label"
                        data-full-text={showTitle ? chipText : undefined}
                        title={showTitle ? chipText : undefined}
                      >
                        {chipText}
                      </span>
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
  );
});

const CALENDAR_SWIPE_BUFFER_RADIUS = 1;
const CALENDAR_SWIPE_CENTER_INDEX = CALENDAR_SWIPE_BUFFER_RADIUS;
const CALENDAR_SWIPE_PANEL_OFFSETS = Array.from(
  { length: CALENDAR_SWIPE_BUFFER_RADIUS * 2 + 1 },
  (_, index) => index - CALENDAR_SWIPE_BUFFER_RADIUS,
);
const EMPTY_PUBLIC_HOLIDAYS: PublicHoliday[] = [];

function groupPublicHolidaysByYear(items: PublicHoliday[]) {
  const grouped = new Map<number, PublicHoliday[]>();
  items.forEach((holiday) => {
    const holidayYear = Number(holiday.date.slice(0, 4));
    const yearHolidays = grouped.get(holidayYear) ?? [];
    yearHolidays.push(holiday);
    grouped.set(holidayYear, yearHolidays);
  });
  return grouped;
}

function CalendarView({
  backgrounds,
  colorDefaults,
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
  onEditEvent,
  onSetBackground,
}: {
  backgrounds: CalendarDayBackground[];
  colorDefaults: CalendarColorDefaults;
  events: CalendarEvent[];
  daysOff: DayOff[];
  holidays: PublicHoliday[];
  selectedDate: string;
  setSelectedDate: (date: string) => void;
  onAddEvent: (range?: DateRange) => void;
  onAddDayOff: (range?: DateRange) => void;
  onDeleteEvent: (event: CalendarEvent) => void;
  onDeleteDayOff: (item: DayOff) => void;
  onVisibleYearChange: (year: number) => void;
  onEditEvent: (event: CalendarEvent) => void;
  onSetBackground: (range: DateRange) => void;
}) {
  const selected = parseDateKey(selectedDate);
  const [visibleMonth, setVisibleMonth] = useState(
    new Date(selected.getFullYear(), selected.getMonth(), 1),
  );
  const [calendarPanelMonths, setCalendarPanelMonths] = useState(() =>
    CALENDAR_SWIPE_PANEL_OFFSETS.map(
      (offset) =>
        new Date(selected.getFullYear(), selected.getMonth() + offset, 1),
    ),
  );
  const [holidaysByYear, setHolidaysByYear] = useState<
    Map<number, PublicHoliday[]>
  >(() => groupPublicHolidaysByYear(holidays));
  const indexedHolidaysRef = useRef(holidays);
  const lastCalendarInteractionRef = useRef(0);
  const [isDaySheetOpen, setIsDaySheetOpen] = useState(false);
  const [dragRange, setDragRange] = useState<DateRange | null>(null);
  const [rangeSheet, setRangeSheet] = useState<DateRange | null>(null);
  const gestureRef = useRef<{
    startX: number;
    startY: number;
    startDate: string;
    currentDate: string;
    pointerId: number;
    longPressTimer: number | null;
    selecting: boolean;
    swiping: boolean;
    lastX: number;
    lastTime: number;
    velocityX: number;
    width: number;
    trackIndex: number;
    target: HTMLDivElement;
  } | null>(null);
  const suppressClickRef = useRef(false);
  const calendarTrackRef = useRef<HTMLDivElement | null>(null);
  const monthTitleRef = useRef<HTMLElement | null>(null);
  const activeMonthRef = useRef(visibleMonth);
  const calendarPanelMonthsRef = useRef(calendarPanelMonths);
  const trackIndexRef = useRef(CALENDAR_SWIPE_CENTER_INDEX);
  const finishSwipeAnimationRef = useRef<(() => void) | null>(null);
  const swipeFrameRef = useRef<number | null>(null);
  const pendingSwipeOffsetRef = useRef(0);
  const swipeAnimationRef = useRef<{
    token: number;
    timer: number | null;
  }>({ token: 0, timer: null });

  const systemEvents = useMemo<CalendarEvent[]>(() => {
    const year = visibleMonth.getFullYear();
    return SYSTEM_ANNIVERSARIES.map(({ day, title }) => ({
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
  const backgroundByDate = useMemo(
    () => new Map(backgrounds.map((item) => [item.date, item])),
    [backgrounds],
  );

  const selectedEvents = allEvents.filter((event) =>
    eventCoversDate(event, selectedDate),
  );
  const selectedDaysOff = daysOff.filter((item) => item.date === selectedDate);
  const selectedHolidays = (
    holidaysByYear.get(parseDateKey(selectedDate).getFullYear()) ??
    EMPTY_PUBLIC_HOLIDAYS
  ).filter((item) => item.is_holiday && item.date === selectedDate);

  useEffect(() => {
    onVisibleYearChange(visibleMonth.getFullYear());
  }, [onVisibleYearChange, visibleMonth]);

  useEffect(() => {
    if (!holidays.length || indexedHolidaysRef.current === holidays) return;
    indexedHolidaysRef.current = holidays;
    let timer = 0;
    const updateWhenIdle = () => {
      const idleFor = performance.now() - lastCalendarInteractionRef.current;
      if (idleFor < 900) {
        timer = window.setTimeout(updateWhenIdle, 900 - idleFor);
        return;
      }
      const incomingByYear = groupPublicHolidaysByYear(holidays);
      startTransition(() => {
        setHolidaysByYear((current) => {
          const next = new Map(current);
          let changed = false;
          incomingByYear.forEach((yearHolidays, holidayYear) => {
            const existing = current.get(holidayYear);
            if (
              existing?.length === yearHolidays.length &&
              existing.every(
                (holiday, index) => holiday === yearHolidays[index],
              )
            ) {
              return;
            }
            next.set(holidayYear, yearHolidays);
            changed = true;
          });
          return changed ? next : current;
        });
      });
    };
    timer = window.setTimeout(updateWhenIdle, 900);
    return () => window.clearTimeout(timer);
  }, [holidays]);

  useLayoutEffect(() => {
    calendarPanelMonthsRef.current = calendarPanelMonths;
    if (monthTitleRef.current) {
      const activeMonth = activeMonthRef.current;
      monthTitleRef.current.textContent =
        `${activeMonth.getFullYear()}년 ${activeMonth.getMonth() + 1}월`;
    }
    syncActiveCalendarPanel(trackIndexRef.current);
  }, [calendarPanelMonths, visibleMonth]);

  useEffect(
    () => () => {
      if (gestureRef.current?.longPressTimer) {
        window.clearTimeout(gestureRef.current.longPressTimer);
      }
      if (swipeAnimationRef.current.timer !== null) {
        window.clearTimeout(swipeAnimationRef.current.timer);
      }
      if (swipeFrameRef.current !== null) {
        window.cancelAnimationFrame(swipeFrameRef.current);
        swipeFrameRef.current = null;
      }
      finishSwipeAnimationRef.current = null;
      swipeAnimationRef.current.token += 1;
    },
    [],
  );

  function paintSwipeOffset() {
    const track = calendarTrackRef.current;
    if (!track) return;
    const width =
      gestureRef.current?.width ??
      Math.max(1, track.parentElement?.clientWidth ?? track.clientWidth);
    const trackIndex =
      gestureRef.current?.trackIndex ?? trackIndexRef.current;
    const x = Math.round(
      -width * trackIndex + pendingSwipeOffsetRef.current,
    );
    track.style.transform = `translate3d(${x}px, 0, 0)`;
  }

  function queueSwipeOffset(offset: number) {
    pendingSwipeOffsetRef.current = offset;
    if (swipeFrameRef.current !== null) return;
    swipeFrameRef.current = window.requestAnimationFrame(() => {
      swipeFrameRef.current = null;
      paintSwipeOffset();
    });
  }

  function flushSwipeOffset() {
    if (swipeFrameRef.current !== null) {
      window.cancelAnimationFrame(swipeFrameRef.current);
      swipeFrameRef.current = null;
    }
    paintSwipeOffset();
  }

  function syncActiveCalendarPanel(index: number) {
    const track = calendarTrackRef.current;
    if (!track) return;
    track
      .querySelectorAll<HTMLElement>(".calendar-month-panel")
      .forEach((panel) => {
        const isActive = Number(panel.dataset.panelIndex) === index;
        panel.classList.toggle("calendar-month-panel--active", isActive);
        panel.setAttribute("aria-hidden", String(!isActive));
        panel.inert = !isActive;
      });
  }

  function settleMonthTrack(
    direction: -1 | 0 | 1,
    targetMonth?: Date,
    targetDate?: string,
  ) {
    finishSwipeAnimationRef.current?.();
    const track = calendarTrackRef.current;
    if (!track) return;
    const currentTrackIndex = trackIndexRef.current;
    const destinationTrackIndex = currentTrackIndex + direction;
    if (swipeFrameRef.current !== null) {
      window.cancelAnimationFrame(swipeFrameRef.current);
      swipeFrameRef.current = null;
    }
    const activeTrack: HTMLDivElement = track;
    const animation = swipeAnimationRef.current;
    animation.token += 1;
    const token = animation.token;
    if (animation.timer !== null) window.clearTimeout(animation.timer);
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const duration = reduceMotion ? 1 : direction === 0 ? 170 : 230;
    const width = Math.max(
      1,
      activeTrack.parentElement?.clientWidth ?? activeTrack.clientWidth,
    );
    const destination = -width * destinationTrackIndex;
    let finished = false;

    if (direction !== 0 && targetMonth) {
      activeMonthRef.current = targetMonth;
      suppressClickRef.current = true;
      if (monthTitleRef.current) {
        monthTitleRef.current.textContent =
          `${targetMonth.getFullYear()}년 ${targetMonth.getMonth() + 1}월`;
      }
    }

    function finish() {
      if (finished || swipeAnimationRef.current.token !== token) return;
      finished = true;
      if (swipeAnimationRef.current.timer !== null) {
        window.clearTimeout(swipeAnimationRef.current.timer);
        swipeAnimationRef.current.timer = null;
      }
      if (finishSwipeAnimationRef.current === finish) {
        finishSwipeAnimationRef.current = null;
      }
      activeTrack.removeEventListener("transitionend", handleTransitionEnd);
      activeTrack.style.transition = "none";
      activeTrack.style.transform = `translate3d(${destination}px, 0, 0)`;
      if (direction !== 0 && targetMonth) {
        const nextPanelMonths = CALENDAR_SWIPE_PANEL_OFFSETS.map(
          (offset) =>
            new Date(
              targetMonth.getFullYear(),
              targetMonth.getMonth() + offset,
              1,
            ),
        );
        calendarPanelMonthsRef.current = nextPanelMonths;
        trackIndexRef.current = CALENDAR_SWIPE_CENTER_INDEX;
        pendingSwipeOffsetRef.current = 0;
        flushSync(() => {
          setCalendarPanelMonths(nextPanelMonths);
          setVisibleMonth(targetMonth);
          setSelectedDate(targetDate ?? toDateKey(targetMonth));
        });
        activeTrack.style.transform =
          `translate3d(${-width * CALENDAR_SWIPE_CENTER_INDEX}px, 0, 0)`;
        syncActiveCalendarPanel(CALENDAR_SWIPE_CENTER_INDEX);
      } else {
        trackIndexRef.current = destinationTrackIndex;
        syncActiveCalendarPanel(destinationTrackIndex);
      }
      window.requestAnimationFrame(() => {
        if (
          swipeAnimationRef.current.token === token &&
          swipeAnimationRef.current.timer === null
        ) {
          activeTrack.style.transition = "";
        }
      });
      suppressClickRef.current = false;
    }

    function handleTransitionEnd(event: TransitionEvent) {
      if (event.target === activeTrack && event.propertyName === "transform") {
        finish();
      }
    }

    activeTrack.style.transition = `transform ${duration}ms cubic-bezier(0.22, 0.78, 0.24, 1)`;
    finishSwipeAnimationRef.current = finish;
    requestAnimationFrame(() => {
      if (swipeAnimationRef.current.token !== token) return;
      activeTrack.style.transform = `translate3d(${destination}px, 0, 0)`;
    });
    activeTrack.addEventListener("transitionend", handleTransitionEnd);
    animation.timer = window.setTimeout(finish, duration + 90);
  }

  function moveMonth(offset: number) {
    lastCalendarInteractionRef.current = performance.now();
    const baseMonth = activeMonthRef.current;
    const direction = offset > 0 ? 1 : -1;
    const next = new Date(
      baseMonth.getFullYear(),
      baseMonth.getMonth() + offset,
      1,
    );
    settleMonthTrack(direction, next, toDateKey(next));
  }

  function startGesture(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    lastCalendarInteractionRef.current = performance.now();
    finishSwipeAnimationRef.current?.();
    const target = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>("[data-calendar-date]");
    const targetDate = target?.dataset.calendarDate;
    const startDate =
      targetDate ?? toDateKey(activeMonthRef.current);
    const gesture = {
      startX: event.clientX,
      startY: event.clientY,
      startDate,
      currentDate: startDate,
      pointerId: event.pointerId,
      longPressTimer: null as number | null,
      selecting: false,
      swiping: false,
      lastX: event.clientX,
      lastTime: performance.now(),
      velocityX: 0,
      width: Math.max(1, event.currentTarget.clientWidth),
      trackIndex: trackIndexRef.current,
      target: event.currentTarget,
    };
    if (targetDate) {
      gesture.longPressTimer = window.setTimeout(() => {
        if (gestureRef.current !== gesture || gesture.swiping) return;
        gesture.selecting = true;
        gesture.longPressTimer = null;
        suppressClickRef.current = true;
        flushSync(() => {
          setIsDaySheetOpen(false);
          setVisibleMonth(activeMonthRef.current);
          setSelectedDate(startDate);
          setDragRange({ start: startDate, end: startDate });
        });
        gesture.target.setPointerCapture?.(gesture.pointerId);
        globalThis.navigator?.vibrate?.(18);
      }, 430);
    }
    gestureRef.current = gesture;
  }

  function moveGesture(event: ReactPointerEvent<HTMLDivElement>) {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    lastCalendarInteractionRef.current = performance.now();

    if (gesture.selecting) {
      event.preventDefault();
      const target = document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest<HTMLElement>("[data-calendar-date]");
      const date = target?.dataset.calendarDate;
      if (date && date !== gesture.currentDate) {
        gesture.currentDate = date;
        setDragRange(normalizeRange(gesture.startDate, date));
      }
      return;
    }

    const deltaX = event.clientX - gesture.startX;
    const deltaY = event.clientY - gesture.startY;
    const moved = Math.hypot(deltaX, deltaY);
    if (moved > 10 && gesture.longPressTimer) {
      window.clearTimeout(gesture.longPressTimer);
      gesture.longPressTimer = null;
    }

    if (
      !gesture.swiping &&
      Math.abs(deltaX) > 8 &&
      Math.abs(deltaX) > Math.abs(deltaY) * 1.05
    ) {
      gesture.swiping = true;
      suppressClickRef.current = true;
      setIsDaySheetOpen(false);
      setRangeSheet(null);
      setDragRange(null);
      gesture.target.setPointerCapture?.(gesture.pointerId);
      if (calendarTrackRef.current) {
        calendarTrackRef.current.style.transition = "none";
      }
    }

    if (!gesture.swiping) return;
    event.preventDefault();
    const now = performance.now();
    const elapsed = Math.max(1, now - gesture.lastTime);
    const instantaneousVelocity = (event.clientX - gesture.lastX) / elapsed;
    gesture.velocityX =
      gesture.velocityX * 0.62 + instantaneousVelocity * 0.38;
    gesture.lastX = event.clientX;
    gesture.lastTime = now;

    const width = gesture.width;
    const limitedOffset = Math.max(
      -width * 0.98,
      Math.min(width * 0.98, deltaX),
    );
    queueSwipeOffset(limitedOffset);
  }

  function finishGesture(event: ReactPointerEvent<HTMLDivElement>) {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (gesture.longPressTimer) {
      window.clearTimeout(gesture.longPressTimer);
      gesture.longPressTimer = null;
    }

    if (gesture.selecting) {
      const range = normalizeRange(gesture.startDate, gesture.currentDate);
      setSelectedDate(range.start);
      setDragRange(null);
      setRangeSheet(range);
      gesture.target.releasePointerCapture?.(gesture.pointerId);
      gestureRef.current = null;
      globalThis.setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
      return;
    }

    const deltaX = event.clientX - gesture.startX;
    if (gesture.swiping) {
      flushSwipeOffset();
      const width = gesture.width;
      const distanceThreshold = Math.min(
        110,
        Math.max(56, width * 0.2),
      );
      const projectedOffset = deltaX + gesture.velocityX * 150;
      const shouldChangeMonth =
        Math.abs(deltaX) >= distanceThreshold ||
        (Math.abs(gesture.velocityX) >= 0.45 && Math.abs(deltaX) >= 16);
      const direction: -1 | 0 | 1 = shouldChangeMonth
        ? projectedOffset < 0
          ? 1
          : -1
        : 0;
      gesture.target.releasePointerCapture?.(gesture.pointerId);
      gestureRef.current = null;
      if (direction === 0) {
        settleMonthTrack(0);
      } else {
        const currentMonth = activeMonthRef.current;
        const next = new Date(
          currentMonth.getFullYear(),
          currentMonth.getMonth() + direction,
          1,
        );
        settleMonthTrack(direction, next, toDateKey(next));
      }
      return;
    }

    gestureRef.current = null;
    globalThis.setTimeout(() => {
      suppressClickRef.current = false;
    }, 0);
  }

  function cancelGesture() {
    const gesture = gestureRef.current;
    if (gesture?.longPressTimer) {
      window.clearTimeout(gesture.longPressTimer);
    }
    if (gesture?.swiping) {
      flushSwipeOffset();
      settleMonthTrack(0);
    }
    gestureRef.current = null;
    setDragRange(null);
  }

  function handleCalendarClick(event: ReactMouseEvent<HTMLDivElement>) {
    if (suppressClickRef.current) return;
    const dateButton = (event.target as Element | null)?.closest<HTMLElement>(
      "[data-calendar-date]",
    );
    const panel = dateButton?.closest<HTMLElement>(
      ".calendar-month-panel",
    );
    const date = dateButton?.dataset.calendarDate;
    const panelYear = Number(panel?.dataset.panelYear);
    const panelMonth = Number(panel?.dataset.panelMonth);
    if (
      !date ||
      !Number.isInteger(panelYear) ||
      !Number.isInteger(panelMonth)
    ) {
      return;
    }
    activeMonthRef.current = new Date(panelYear, panelMonth, 1);
    flushSync(() => {
      setVisibleMonth(activeMonthRef.current);
      setSelectedDate(date);
      setIsDaySheetOpen(true);
    });
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
              finishSwipeAnimationRef.current?.();
              activeMonthRef.current = todayMonth;
              const nextPanelMonths = CALENDAR_SWIPE_PANEL_OFFSETS.map(
                (offset) =>
                  new Date(
                    todayMonth.getFullYear(),
                    todayMonth.getMonth() + offset,
                    1,
                  ),
              );
              calendarPanelMonthsRef.current = nextPanelMonths;
              trackIndexRef.current = CALENDAR_SWIPE_CENTER_INDEX;
              pendingSwipeOffsetRef.current = 0;
              const track = calendarTrackRef.current;
              const width = Math.max(
                1,
                track?.parentElement?.clientWidth ?? track?.clientWidth ?? 1,
              );
              if (track) track.style.transition = "none";
              flushSync(() => {
                setCalendarPanelMonths(nextPanelMonths);
                setVisibleMonth(todayMonth);
                setSelectedDate(toDateKey(today));
              });
              if (track) {
                track.style.transform =
                  `translate3d(${-width * CALENDAR_SWIPE_CENTER_INDEX}px, 0, 0)`;
              }
              syncActiveCalendarPanel(CALENDAR_SWIPE_CENTER_INDEX);
            }}
            type="button"
          >
            <strong ref={monthTitleRef}>
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
          className="calendar-viewport"
          onClick={handleCalendarClick}
          onPointerCancel={cancelGesture}
          onPointerDown={startGesture}
          onPointerMove={moveGesture}
          onPointerUp={finishGesture}
          onContextMenu={(event) => event.preventDefault()}
        >
          <div className="calendar-track" ref={calendarTrackRef}>
            {calendarPanelMonths.map((panelMonth, panelIndex) => {
              const panelYear = panelMonth.getFullYear();
              const panelMonthIndex = panelMonth.getMonth();
              const isActivePanel =
                panelMonth.getTime() === visibleMonth.getTime();

              return (
                <div
                  aria-hidden={!isActivePanel}
                  className={`calendar-month-panel${
                    isActivePanel ? " calendar-month-panel--active" : ""
                  }`}
                  data-panel-index={panelIndex}
                  data-panel-month={panelMonthIndex}
                  data-panel-year={panelYear}
                  inert={!isActivePanel}
                  key={`${panelYear}-${panelMonthIndex}`}
                >
                  <CalendarMonthGrid
                    backgroundByDate={backgroundByDate}
                    colorDefaults={colorDefaults}
                    daysOff={daysOff}
                    events={events}
                    holidays={
                      holidaysByYear.get(panelYear) ?? EMPTY_PUBLIC_HOLIDAYS
                    }
                    monthIndex={panelMonthIndex}
                    selectedRange={isActivePanel ? dragRange : null}
                    year={panelYear}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {isDaySheetOpen ? (
        <CalendarDaySheet
          colorDefaults={colorDefaults}
          date={selectedDate}
          daysOff={selectedDaysOff}
          events={selectedEvents}
          holidays={selectedHolidays}
          onAddDayOff={onAddDayOff}
          onAddEvent={onAddEvent}
          onClose={() => setIsDaySheetOpen(false)}
          onDeleteDayOff={onDeleteDayOff}
          onDeleteEvent={onDeleteEvent}
          onEditEvent={onEditEvent}
          onSetBackground={() =>
            onSetBackground({ start: selectedDate, end: selectedDate })
          }
        />
      ) : null}
      {rangeSheet ? (
        <CalendarRangeSheet
          onAddDayOff={() => {
            setRangeSheet(null);
            onAddDayOff(rangeSheet);
          }}
          onAddEvent={() => {
            setRangeSheet(null);
            onAddEvent(rangeSheet);
          }}
          onClose={() => setRangeSheet(null)}
          onSetBackground={() => {
            setRangeSheet(null);
            onSetBackground(rangeSheet);
          }}
          range={rangeSheet}
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
        <form className="quick-form" onSubmit={submit}>
          <label className="field field--grow">
            <span className="sr-only">할 일 제목</span>
            <input
              onChange={(event) => setTitle(event.target.value)}
              placeholder="할일 입력!"
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
        <div className="inline-input">
          <input
            aria-label="쇼핑 품목"
            onChange={(event) => setName(event.target.value)}
            placeholder="살거 입력!"
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
  ["trip_checklist", "준비물"],
  ["trip_notepad", "메모장"],
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
        transport_type: transportation?.transport_type ?? "기타",
        title,
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
          <label className="field">
            <span>제목 *</span>
            <input
              autoFocus
              defaultValue={transportation?.title ?? ""}
              name="title"
              required
            />
          </label>
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
          </>
        )}

        {resource !== "trip_foods" &&
        resource !== "trip_places" &&
        resource !== "trip_transportations" ? (
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
          <textarea
            defaultValue={item?.memo ?? ""}
            name="memo"
            placeholder={
              resource === "trip_transportations"
                ? "시간, 위치, 예약 정보 등을 자유롭게 입력"
                : undefined
            }
            rows={resource === "trip_transportations" ? 8 : 3}
          />
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

function TripListCard({
  trip,
  today,
  isPast = false,
  isSelected,
  index,
  onOpen,
  onChooseCountry,
  isActionMenuOpen,
  onOpenActionMenu,
  onDelete,
}: {
  trip: Trip;
  today: string;
  isPast?: boolean;
  isSelected: boolean;
  index?: number;
  onOpen: () => void;
  onChooseCountry: () => void;
  isActionMenuOpen: boolean;
  onOpenActionMenu: () => void;
  onDelete: () => void;
}) {
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressStart = useRef<{ x: number; y: number } | null>(null);
  const longPressTriggered = useRef(false);
  const inProgress = trip.start_date <= today && trip.end_date >= today;
  const code = tripCountryCode(trip);
  const countryName = code ? koreanRegionNames.of(code) : null;
  const status = isPast
    ? "지난 여행"
    : inProgress
      ? "여행 중"
      : daysUntil(trip.start_date) >= 0
        ? `D-${daysUntil(trip.start_date)}`
        : "예정";

  function clearLongPress() {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    longPressTimer.current = null;
    pressStart.current = null;
  }

  function startLongPress(event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return;
    longPressTriggered.current = false;
    pressStart.current = { x: event.clientX, y: event.clientY };
    longPressTimer.current = setTimeout(() => {
      longPressTriggered.current = true;
      onOpenActionMenu();
    }, 560);
  }

  function moveLongPress(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!pressStart.current) return;
    if (
      Math.abs(event.clientX - pressStart.current.x) > 10 ||
      Math.abs(event.clientY - pressStart.current.y) > 10
    ) {
      clearLongPress();
    }
  }

  return (
    <article
      className={`trip-card${isSelected ? " trip-card--selected" : ""}${
        isActionMenuOpen ? " trip-card--menu-open" : ""
      }`}
      style={index === undefined ? undefined : { animationDelay: `${index * 50}ms` }}
    >
      <button
        aria-label={`${trip.title} 국기 설정${countryName ? `, 현재 ${countryName}` : ""}`}
        className={`trip-visual${isPast ? " trip-visual--past" : ""}`}
        onClick={(event) => {
          if (longPressTriggered.current) {
            event.preventDefault();
            longPressTriggered.current = false;
            return;
          }
          onChooseCountry();
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          clearLongPress();
          onOpenActionMenu();
        }}
        onPointerCancel={clearLongPress}
        onPointerDown={startLongPress}
        onPointerLeave={clearLongPress}
        onPointerMove={moveLongPress}
        onPointerUp={clearLongPress}
        type="button"
      >
        <span aria-hidden="true" className="trip-country-flag">
          {countryFlag(code)}
        </span>
        <small>{status}</small>
        <i aria-hidden="true">변경</i>
      </button>
      <button
        aria-expanded={isActionMenuOpen}
        aria-haspopup="menu"
        aria-label={`${trip.title} 상세 열기`}
        className="trip-card-open"
        onClick={(event) => {
          if (longPressTriggered.current) {
            event.preventDefault();
            longPressTriggered.current = false;
            return;
          }
          onOpen();
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          clearLongPress();
          onOpenActionMenu();
        }}
        onKeyDown={(event) => {
          if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
            event.preventDefault();
            onOpenActionMenu();
          }
        }}
        onPointerCancel={clearLongPress}
        onPointerDown={startLongPress}
        onPointerLeave={clearLongPress}
        onPointerMove={moveLongPress}
        onPointerUp={clearLongPress}
        type="button"
      >
        <span className="trip-copy">
          <strong>{trip.title}</strong>
          <span className="trip-period">
            {isPast
              ? `${formatKoreanDate(trip.end_date)} 종료`
              : `${formatKoreanDate(trip.start_date)} — ${formatKoreanDate(
                  trip.end_date,
                )}`}
          </span>
        </span>
        <span aria-hidden="true" className="trip-card-chevron">
          ›
        </span>
      </button>
      {isActionMenuOpen ? (
        <div
          aria-label={`${trip.title} 관리`}
          className="trip-card-menu"
          onPointerDown={(event) => event.stopPropagation()}
          role="menu"
        >
          <button onClick={onDelete} role="menuitem" type="button">
            여행 삭제
          </button>
        </div>
      ) : null}
    </article>
  );
}

function CountryPicker({
  trip,
  onClose,
  onSelect,
}: {
  trip: Trip;
  onClose: () => void;
  onSelect: (code: string) => void;
}) {
  const [query, setQuery] = useState("");
  const selectedCode = tripCountryCode(trip) ?? null;
  const filteredCountries = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("ko-KR");
    if (!normalized) return COUNTRIES;
    return COUNTRIES.filter((country) =>
      [
        country.name,
        country.englishName,
        country.code,
        COUNTRY_SEARCH_ALIASES[country.code] ?? "",
      ].some((value) => value.toLocaleLowerCase("ko-KR").includes(normalized)),
    );
  }, [query]);

  return (
    <Modal className="country-picker-modal" onClose={onClose} title="국기 선택">
      <label className="country-search">
        <span aria-hidden="true">⌕</span>
        <input
          autoFocus
          onChange={(event) => setQuery(event.target.value)}
          placeholder="나라 이름 검색"
          type="search"
          value={query}
        />
      </label>
      {filteredCountries.length ? (
        <div className="country-list" role="list">
          {filteredCountries.map((country) => (
            <button
              aria-pressed={selectedCode === country.code}
              className="country-option"
              key={country.code}
              onClick={() => onSelect(country.code)}
              type="button"
            >
              <span aria-hidden="true">{countryFlag(country.code)}</span>
              <strong>{country.name}</strong>
              <small>{country.code}</small>
              <i aria-hidden="true">
                {selectedCode === country.code ? "✓" : ""}
              </i>
            </button>
          ))}
        </div>
      ) : (
        <p className="country-empty">검색 결과가 없습니다.</p>
      )}
    </Modal>
  );
}

function TripChecklistPanel({
  items,
  onAdd,
  onDelete,
  onToggle,
}: {
  items: TripChecklistItem[];
  onAdd: (title: string) => void;
  onDelete: (id: string) => void;
  onToggle: (id: string) => void;
}) {
  const [title, setTitle] = useState("");
  const completed = items.filter((item) => item.is_checked).length;

  return (
    <div className="trip-checklist-panel">
      <form
        className="trip-checklist-add"
        onSubmit={(event) => {
          event.preventDefault();
          const value = title.trim();
          if (!value) return;
          onAdd(value);
          setTitle("");
        }}
      >
        <input
          aria-label="준비물"
          onChange={(event) => setTitle(event.target.value)}
          placeholder="준비물 추가"
          value={title}
        />
        <button className="button button--primary" type="submit">
          추가
        </button>
      </form>
      {items.length ? (
        <>
          <div className="trip-checklist-progress">
            <span>
              {completed} / {items.length}
            </span>
            <i>
              <span
                style={{
                  width: `${Math.round((completed / items.length) * 100)}%`,
                }}
              />
            </i>
          </div>
          <div className="trip-checklist-list">
            {items.map((item) => (
              <div
                className={`trip-checklist-item${
                  item.is_checked ? " is-complete" : ""
                }`}
                key={item.id}
              >
                <button
                  aria-label={`${item.title} ${
                    item.is_checked ? "체크 해제" : "체크"
                  }`}
                  aria-pressed={item.is_checked}
                  className="travel-check"
                  onClick={() => onToggle(item.id)}
                  type="button"
                >
                  {item.is_checked ? "✓" : ""}
                </button>
                <strong>{item.title}</strong>
                <button
                  aria-label={`${item.title} 삭제`}
                  className="icon-button icon-button--small"
                  onClick={() => onDelete(item.id)}
                  type="button"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </>
      ) : (
        <p className="trip-empty-copy">준비물이 없습니다.</p>
      )}
    </div>
  );
}

function TripNotepad({
  trip,
  onSave,
}: {
  trip: Trip;
  onSave: (memo: string) => void;
}) {
  const [memo, setMemo] = useState(() => visibleTripMemo(trip.memo));

  return (
    <form
      className="trip-notepad"
      onSubmit={(event) => {
        event.preventDefault();
        onSave(memo);
      }}
    >
      <textarea
        aria-label="여행 메모"
        onChange={(event) => setMemo(event.target.value)}
        placeholder="자유롭게 적어두기"
        rows={12}
        value={memo}
      />
      <button className="button button--primary" type="submit">
        메모 저장
      </button>
    </form>
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
  onUpdateCountry,
  onUpdateChecklist,
  onUpdateMemo,
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
  onUpdateCountry: (trip: Trip, countryCode: string) => void;
  onUpdateChecklist: (trip: Trip, items: TripChecklistItem[]) => void;
  onUpdateMemo: (trip: Trip, memo: string) => void;
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
  const [selectedTrip, setSelectedTrip] = useState<string | null>(null);
  const [countryPickerTrip, setCountryPickerTrip] = useState<string | null>(
    null,
  );
  const [actionMenuTrip, setActionMenuTrip] = useState<string | null>(null);
  const [section, setSection] = useState<TripSection>("overview");
  const [editor, setEditor] = useState<{
    resource: TripDetailResource;
    item?: TripDetailItem;
  } | null>(null);
  const detail = trips.find((trip) => trip.id === selectedTrip);
  const countryTrip = trips.find((trip) => trip.id === countryPickerTrip);
  const detailChecklist = tripChecklistFromMemo(detail?.memo);

  const detailFlights = flights.filter((item) => item.trip_id === detail?.id);
  const detailAccommodations = accommodations.filter(
    (item) => item.trip_id === detail?.id,
  );
  const detailTransportations = transportations.filter(
    (item) => item.trip_id === detail?.id,
  );
  const detailFoods = foods.filter((item) => item.trip_id === detail?.id);
  const detailPlaces = places.filter((item) => item.trip_id === detail?.id);

  useEffect(() => {
    if (!actionMenuTrip) return;
    const closeActionMenu = () => setActionMenuTrip(null);
    window.addEventListener("pointerdown", closeActionMenu);
    return () => window.removeEventListener("pointerdown", closeActionMenu);
  }, [actionMenuTrip]);

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
            <h2>✈️</h2>
          </div>
          <button className="button button--primary" onClick={onAdd} type="button">
            + 여행 추가
          </button>
        </div>

        {upcoming.length ? (
          <div className="trip-list">
            {upcoming.map((trip, index) => (
              <TripListCard
                index={index}
                isActionMenuOpen={actionMenuTrip === trip.id}
                isSelected={selectedTrip === trip.id}
                key={trip.id}
                onChooseCountry={() => setCountryPickerTrip(trip.id)}
                onDelete={() => {
                  setActionMenuTrip(null);
                  onDeleteTrip(trip);
                }}
                onOpen={() => {
                  setActionMenuTrip(null);
                  setSelectedTrip(trip.id);
                  setSection("overview");
                }}
                onOpenActionMenu={() => setActionMenuTrip(trip.id)}
                today={today}
                trip={trip}
              />
            ))}
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
                <TripListCard
                  isPast
                  isActionMenuOpen={actionMenuTrip === trip.id}
                  isSelected={selectedTrip === trip.id}
                  key={trip.id}
                  onChooseCountry={() => setCountryPickerTrip(trip.id)}
                  onDelete={() => {
                    setActionMenuTrip(null);
                    onDeleteTrip(trip);
                  }}
                  onOpen={() => {
                    setActionMenuTrip(null);
                    setSelectedTrip(trip.id);
                    setSection("overview");
                  }}
                  onOpenActionMenu={() => setActionMenuTrip(trip.id)}
                  today={today}
                  trip={trip}
                />
              ))}
            </div>
          </details>
        ) : null}
      </div>

      {detail ? (
        <Modal
          className="trip-detail-modal"
          description={`${formatKoreanDate(
            detail.start_date,
            true,
          )} — ${formatKoreanDate(detail.end_date, true)}`}
          onClose={() => {
            setEditor(null);
            setSelectedTrip(null);
          }}
          title={`${countryFlag(tripCountryCode(detail))} ${detail.title}`}
        >
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
              <div className="trip-overview-summaries">
                <section className="trip-overview-summary">
                  <button
                    className="trip-overview-summary-head"
                    onClick={() => setSection("trip_flights")}
                    type="button"
                  >
                    <span aria-hidden="true">✈</span>
                    <strong>항공</strong>
                    <small>{detailFlights.length || "미등록"} ›</small>
                  </button>
                  {detailFlights.length ? (
                    <div className="trip-overview-rows">
                      {detailFlights.map((item) => (
                        <div className="trip-overview-row" key={item.id}>
                          <small>
                            {item.direction}
                            {item.airline ? ` · ${item.airline}` : ""}
                            {item.flight_number ? ` ${item.flight_number}` : ""}
                          </small>
                          <span className="trip-overview-route">
                            <strong>
                              {item.departure_airport ||
                                item.departure_city ||
                                "출발지 미정"}
                            </strong>
                            <i aria-hidden="true">→</i>
                            <strong>
                              {item.arrival_airport ||
                                item.arrival_city ||
                                "도착지 미정"}
                            </strong>
                          </span>
                          {item.departure_at || item.arrival_at ? (
                            <span className="trip-overview-time">
                              {item.departure_at
                                ? formatDateTime(item.departure_at)
                                : "시간 미정"}
                              {" → "}
                              {item.arrival_at
                                ? formatDateTime(item.arrival_at)
                                : "시간 미정"}
                            </span>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <button
                      className="trip-overview-empty"
                      onClick={() => setSection("trip_flights")}
                      type="button"
                    >
                      + 항공편
                    </button>
                  )}
                </section>

                <section className="trip-overview-summary">
                  <button
                    className="trip-overview-summary-head"
                    onClick={() => setSection("trip_accommodations")}
                    type="button"
                  >
                    <span aria-hidden="true">⌂</span>
                    <strong>숙소</strong>
                    <small>{detailAccommodations.length || "미등록"} ›</small>
                  </button>
                  {detailAccommodations.length ? (
                    <div className="trip-overview-rows">
                      {detailAccommodations.map((item) => (
                        <div className="trip-overview-row" key={item.id}>
                          <strong>{item.name}</strong>
                          {item.check_in_at || item.check_out_at ? (
                            <span className="trip-overview-time">
                              {item.check_in_at
                                ? formatDateTime(item.check_in_at)
                                : "체크인 미정"}
                              {" → "}
                              {item.check_out_at
                                ? formatDateTime(item.check_out_at)
                                : "체크아웃 미정"}
                            </span>
                          ) : item.address ? (
                            <span className="trip-overview-time">{item.address}</span>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <button
                      className="trip-overview-empty"
                      onClick={() => setSection("trip_accommodations")}
                      type="button"
                    >
                      + 숙소
                    </button>
                  )}
                </section>
              </div>

              <div className="trip-overview-secondary">
                <button
                  onClick={() => setSection("trip_transportations")}
                  type="button"
                >
                  교통 <strong>{detailTransportations.length}</strong>
                </button>
                <button onClick={() => setSection("trip_foods")} type="button">
                  먹을 것 <strong>{detailFoods.length}</strong>
                </button>
                <button onClick={() => setSection("trip_places")} type="button">
                  갈 곳 <strong>{detailPlaces.length}</strong>
                </button>
              </div>

            </div>
          ) : section === "trip_checklist" ? (
            <TripChecklistPanel
              items={detailChecklist}
              onAdd={(title) =>
                onUpdateChecklist(detail, [
                  ...detailChecklist,
                  { id: newId(), title, is_checked: false },
                ])
              }
              onDelete={(id) =>
                onUpdateChecklist(
                  detail,
                  detailChecklist.filter((item) => item.id !== id),
                )
              }
              onToggle={(id) =>
                onUpdateChecklist(
                  detail,
                  detailChecklist.map((item) =>
                    item.id === id
                      ? { ...item, is_checked: !item.is_checked }
                      : item,
                  ),
                )
              }
            />
          ) : section === "trip_notepad" ? (
            <TripNotepad
              key={detail.id}
              onSave={(memo) => onUpdateMemo(detail, memo)}
              trip={detail}
            />
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
                        {item.memo ? (
                          <p className="transportation-memo">{item.memo}</p>
                        ) : null}
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
        </Modal>
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

      {countryTrip ? (
        <CountryPicker
          onClose={() => setCountryPickerTrip(null)}
          onSelect={(countryCode) => {
            onUpdateCountry(countryTrip, countryCode);
            setCountryPickerTrip(null);
          }}
          trip={countryTrip}
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
          <h2>🍰</h2>
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
          🚙
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

function NotificationToggleButton({
  status,
  onToggle,
}: {
  status: PushStatus;
  onToggle: () => void;
}) {
  const enabled = status === "enabled";
  const labels: Record<PushStatus, string> = {
    checking: "일정 알림 확인 중",
    unsupported: "이 기기에서는 일정 알림을 사용할 수 없음",
    unconfigured: "일정 알림 서버 설정 필요",
    disabled: "매일 오전 8시 일정 알림 켜기",
    denied: "일정 알림 권한이 차단됨",
    enabled: "매일 오전 8시 일정 알림 켜짐, 끄기",
    loading: "일정 알림 설정 중",
  };

  return (
    <button
      aria-label={labels[status]}
      aria-pressed={enabled}
      className={`notification-toggle-button${enabled ? " is-enabled" : ""}${
        status === "denied" ? " is-denied" : ""
      }`}
      disabled={status === "checking" || status === "loading"}
      onClick={onToggle}
      title={labels[status]}
      type="button"
    >
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
      </svg>
    </button>
  );
}

function supportsWebPush() {
  return (
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

function urlBase64ToUint8Array(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replaceAll("-", "+").replaceAll("_", "/");
  const rawData = globalThis.atob(base64);
  return Uint8Array.from(rawData, (character) => character.charCodeAt(0));
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
  const [taskTab, setTaskTab] = useState<TaskTab>("todo");
  const [modal, setModal] = useState<ModalName>(null);
  const [selectedDate, setSelectedDate] = useState(initialCalendarDate);
  const [eventRange, setEventRange] = useState<DateRange>({
    start: toDateKey(new Date()),
    end: toDateKey(new Date()),
  });
  const [dayOffRange, setDayOffRange] = useState<DateRange>({
    start: toDateKey(new Date()),
    end: toDateKey(new Date()),
  });
  const [backgroundRange, setBackgroundRange] = useState<DateRange>({
    start: toDateKey(new Date()),
    end: toDateKey(new Date()),
  });
  const [eventScope, setEventScope] =
    useState<CalendarEventScope>("personal");
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);
  const [editingFridge, setEditingFridge] = useState<FridgeItem | null>(null);
  const [holidayYear, setHolidayYear] = useState(new Date().getFullYear());
  const [toast, setToast] = useState<string | null>(null);
  const [pushStatus, setPushStatus] = useState<PushStatus>("checking");
  const [cacheReadyUser, setCacheReadyUser] = useState<UserCode | null>(null);
  const [isDataLoading, setIsDataLoading] = useState(true);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [calendarColorDefaults, setCalendarColorDefaults] =
    useState<CalendarColorDefaults>(FALLBACK_CALENDAR_COLOR_DEFAULTS);
  const [daysOff, setDaysOff] = useState<DayOff[]>([]);
  const [dayBackgrounds, setDayBackgrounds] = useState<
    CalendarDayBackground[]
  >([]);
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
  const loadedHolidayYears = useRef(new Set<number>());
  const pushRegistrationRef = useRef<ServiceWorkerRegistration | null>(null);
  const vapidPublicKeyRef = useRef("");
  const restoredCacheUserRef = useRef<UserCode | null>(null);
  const authenticationRejectedRef = useRef(false);
  const cacheRestoredAtRef = useRef(0);
  const lastUiInteractionRef = useRef(0);

  const currentDataSnapshot = useMemo<OipDataSnapshot>(
    () => ({
      events,
      calendarColorDefaults,
      daysOff,
      dayBackgrounds,
      holidays,
      todos,
      shopping,
      trips,
      tripFlights,
      tripAccommodations,
      tripTransportations,
      tripFoods,
      tripPlaces,
      fridge,
      parking,
    }),
    [
      events,
      calendarColorDefaults,
      daysOff,
      dayBackgrounds,
      holidays,
      todos,
      shopping,
      trips,
      tripFlights,
      tripAccommodations,
      tripTransportations,
      tripFoods,
      tripPlaces,
      fridge,
      parking,
    ],
  );

  const isCalendarPage =
    authState === "ready" && mainTab === "schedule";

  useEffect(() => {
    const className = "calendar-scroll-locked";
    document.documentElement.classList.toggle(className, isCalendarPage);
    document.body.classList.toggle(className, isCalendarPage);
    let lastTap: { time: number; x: number; y: number } | null = null;

    function preventCalendarDoubleTapZoom(event: TouchEvent) {
      const touch = event.changedTouches.item(0);
      if (!touch || event.changedTouches.length !== 1) {
        lastTap = null;
        return;
      }

      const now = Date.now();
      const isSamePosition =
        lastTap !== null &&
        Math.hypot(touch.clientX - lastTap.x, touch.clientY - lastTap.y) < 28;
      if (lastTap && now - lastTap.time < 360 && isSamePosition) {
        event.preventDefault();
        lastTap = null;
        return;
      }
      lastTap = { time: now, x: touch.clientX, y: touch.clientY };
    }

    if (isCalendarPage) {
      window.scrollTo({ top: 0 });
      document.addEventListener("touchend", preventCalendarDoubleTapZoom, {
        passive: false,
      });
    }

    return () => {
      document.documentElement.classList.remove(className);
      document.body.classList.remove(className);
      document.removeEventListener("touchend", preventCalendarDoubleTapZoom);
    };
  }, [isCalendarPage]);

  useEffect(() => {
    const markInteraction = () => {
      lastUiInteractionRef.current = performance.now();
    };
    window.addEventListener("pointerdown", markInteraction, {
      capture: true,
      passive: true,
    });
    window.addEventListener("keydown", markInteraction, { capture: true });
    return () => {
      window.removeEventListener("pointerdown", markInteraction, {
        capture: true,
      });
      window.removeEventListener("keydown", markInteraction, {
        capture: true,
      });
    };
  }, []);

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

  const applyDataSnapshot = useCallback((data: OipDataSnapshot) => {
    setEvents((current) => retainEquivalentValue(current, data.events ?? []));
    if (data.calendarColorDefaults) {
      setCalendarColorDefaults((current) =>
        retainEquivalentValue(current, data.calendarColorDefaults!),
      );
    }
    setDaysOff((current) =>
      retainEquivalentValue(current, data.daysOff ?? []),
    );
    setDayBackgrounds((current) =>
      retainEquivalentValue(current, data.dayBackgrounds ?? []),
    );
    setHolidays((current) =>
      retainEquivalentValue(current, data.holidays ?? []),
    );
    setTodos((current) => retainEquivalentValue(current, data.todos ?? []));
    setShopping((current) =>
      retainEquivalentValue(current, data.shopping ?? []),
    );
    setTrips((current) => retainEquivalentValue(current, data.trips ?? []));
    setTripFlights((current) =>
      retainEquivalentValue(current, data.tripFlights ?? []),
    );
    setTripAccommodations((current) =>
      retainEquivalentValue(current, data.tripAccommodations ?? []),
    );
    setTripTransportations((current) =>
      retainEquivalentValue(current, data.tripTransportations ?? []),
    );
    setTripFoods((current) =>
      retainEquivalentValue(current, data.tripFoods ?? []),
    );
    setTripPlaces((current) =>
      retainEquivalentValue(current, data.tripPlaces ?? []),
    );
    setFridge((current) => retainEquivalentValue(current, data.fridge ?? []));
    setParking((current) =>
      retainEquivalentValue(current, data.parking ?? null),
    );
  }, []);

  useLayoutEffect(() => {
    const stored = localStorage.getItem("oip.currentUser");
    if (stored !== "daeho" && stored !== "sanghee") return;
    let active = true;

    const restore = (cached: { data: OipDataSnapshot } | null) => {
      if (!active || !cached || authenticationRejectedRef.current) return;
      restoredCacheUserRef.current = stored;
      cacheRestoredAtRef.current = performance.now();
      applyDataSnapshot(cached.data);
      setCurrentUser(stored);
      setCacheReadyUser(stored);
      setIsDataLoading(false);
      setAuthState("ready");
    };

    const synchronousCache = readOipDataCacheSync(stored);
    if (synchronousCache) {
      restore(synchronousCache);
    } else {
      void readOipDataCache(stored)
        .then(restore)
        .catch(() => undefined);
    }

    return () => {
      active = false;
    };
  }, [applyDataSnapshot]);

  const savePushSubscription = useCallback(
    async (
      subscription: PushSubscription,
      user: UserCode,
      sendTest: boolean,
    ) => {
      const response = await fetch("/api/push/subscription", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...subscription.toJSON(),
          user_code: user,
          send_test: sendTest,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        saved?: boolean;
        testSent?: boolean;
        error?: string;
      };
      return { response, data };
    },
    [],
  );

  const removeDevicePushSubscription = useCallback(async () => {
    if (!("serviceWorker" in navigator)) return;
    const registration =
      pushRegistrationRef.current ??
      (await navigator.serviceWorker.getRegistration("/"));
    const subscription = await registration?.pushManager.getSubscription();
    if (!subscription) return;
    await fetch("/api/push/subscription", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: subscription.endpoint }),
    }).catch(() => undefined);
    await subscription.unsubscribe().catch(() => false);
  }, []);

  useEffect(() => {
    if (authState !== "ready") return;
    let active = true;

    async function preparePushNotifications() {
      if (!supportsWebPush()) {
        if (active) setPushStatus("unsupported");
        return;
      }

      try {
        const registration = await navigator.serviceWorker.register("/sw.js", {
          scope: "/",
        });
        const response = await fetch("/api/push/subscription", {
          cache: "no-store",
        });
        const config = (await response.json().catch(() => ({}))) as {
          configured?: boolean;
          publicKey?: string | null;
        };
        if (!response.ok || !config.configured || !config.publicKey) {
          if (active) setPushStatus("unconfigured");
          return;
        }

        pushRegistrationRef.current = registration;
        vapidPublicKeyRef.current = config.publicKey;
        if (Notification.permission === "denied") {
          if (active) setPushStatus("denied");
          return;
        }

        const subscription = await registration.pushManager.getSubscription();
        if (!subscription) {
          if (active) setPushStatus("disabled");
          return;
        }

        const saved = await savePushSubscription(
          subscription,
          currentUser,
          false,
        );
        if (active) {
          setPushStatus(saved.response.ok ? "enabled" : "unconfigured");
        }
      } catch {
        if (active) setPushStatus("unsupported");
      }
    }

    void preparePushNotifications();
    return () => {
      active = false;
    };
  }, [authState, currentUser, savePushSubscription]);

  async function togglePushNotifications() {
    if (pushStatus === "unsupported") {
      showToast("아이폰 홈 화면의 OIP 앱에서 다시 시도해 주세요.");
      return;
    }
    if (pushStatus === "unconfigured") {
      showToast("푸시 알림 서버 설정을 먼저 완료해 주세요.");
      return;
    }
    if (pushStatus === "denied") {
      showToast("아이폰 설정 → 알림 → OIP에서 알림을 허용해 주세요.");
      return;
    }
    if (pushStatus === "enabled") {
      setPushStatus("loading");
      try {
        await removeDevicePushSubscription();
        setPushStatus("disabled");
      } catch {
        setPushStatus("enabled");
        showToast("알림을 끄지 못했어요. 다시 시도해 주세요.");
      }
      return;
    }
    if (pushStatus !== "disabled") return;

    const permissionRequest =
      Notification.permission === "default"
        ? Notification.requestPermission()
        : Promise.resolve(Notification.permission);
    setPushStatus("loading");

    try {
      const permission = await permissionRequest;
      if (permission !== "granted") {
        setPushStatus(permission === "denied" ? "denied" : "disabled");
        showToast("일정 알림 권한이 필요해요.");
        return;
      }
      const registration =
        pushRegistrationRef.current ??
        (await navigator.serviceWorker.register("/sw.js", { scope: "/" }));
      const publicKey = vapidPublicKeyRef.current;
      if (!publicKey) throw new Error("VAPID_PUBLIC_KEY_MISSING");

      const existing = await registration.pushManager.getSubscription();
      const subscription =
        existing ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        }));
      const saved = await savePushSubscription(
        subscription,
        currentUser,
        true,
      );
      if (!saved.response.ok && !saved.data.saved) {
        await subscription.unsubscribe().catch(() => false);
        throw new Error(saved.data.error ?? "PUSH_SUBSCRIPTION_SAVE_FAILED");
      }

      setPushStatus("enabled");
      if (!saved.data.testSent) {
        showToast("알림은 켰지만 테스트 전송을 확인하지 못했어요.");
      }
    } catch {
      setPushStatus("disabled");
      showToast("일정 알림을 켜지 못했어요. 다시 시도해 주세요.");
    }
  }

  useEffect(() => {
    let active = true;
    fetch("/api/auth")
      .then((response) => response.json())
      .then((data: { authenticated?: boolean }) => {
        if (!active) return;
        if (!data.authenticated) {
          authenticationRejectedRef.current = true;
          restoredCacheUserRef.current = null;
          void clearOipDataCache().catch(() => undefined);
          setIsDataLoading(true);
          setAuthState("locked");
          return;
        }
        authenticationRejectedRef.current = false;
        const stored = localStorage.getItem("oip.currentUser");
        if (stored === "daeho" || stored === "sanghee") {
          setCurrentUser(stored);
          setAuthState("ready");
        } else {
          setAuthState("selecting");
        }
      })
      .catch(() => {
        if (active && restoredCacheUserRef.current === null) {
          setAuthState("locked");
        }
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
    ] as const;

    async function loadData() {
      let restoredFromCache =
        restoredCacheUserRef.current === currentUser;
      if (!restoredFromCache) {
        try {
          const cached = await readOipDataCache(currentUser);
          if (!active) return;
          if (cached) {
            applyDataSnapshot(cached.data);
            restoredCacheUserRef.current = currentUser;
            cacheRestoredAtRef.current = performance.now();
            restoredFromCache = true;
            setCacheReadyUser(currentUser);
            setIsDataLoading(false);
          }
        } catch {
          // IndexedDB may be unavailable in private browsing or restricted modes.
        }
      }

      while (active && restoredFromCache) {
        const quietSince = Math.max(
          cacheRestoredAtRef.current,
          lastUiInteractionRef.current,
        );
        const remainingQuietTime =
          900 - (performance.now() - quietSince);
        if (remainingQuietTime <= 0) break;
        await new Promise((resolve) =>
          window.setTimeout(resolve, Math.min(remainingQuietTime, 300)),
        );
      }
      if (!active) return;

      try {
        const entries = await Promise.all(
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
        );
        if (!active) return;
        const loaded = Object.fromEntries(entries) as Record<string, unknown>;
        startTransition(() => {
          setEvents((current) =>
            retainEquivalentValue(
              current,
              (loaded.calendar_events as CalendarEvent[]) ?? [],
            ),
          );
          setDaysOff((current) =>
            retainEquivalentValue(
              current,
              (loaded.calendar_days_off as DayOff[]) ?? [],
            ),
          );
          setTodos((current) =>
            retainEquivalentValue(
              current,
              (loaded.todos as Todo[]) ?? [],
            ),
          );
          setShopping((current) =>
            retainEquivalentValue(
              current,
              (loaded.shopping_items as ShoppingItem[]) ?? [],
            ),
          );
          setTrips((current) =>
            retainEquivalentValue(current, (loaded.trips as Trip[]) ?? []),
          );
          setTripFlights((current) =>
            retainEquivalentValue(
              current,
              (loaded.trip_flights as TripFlight[]) ?? [],
            ),
          );
          setTripAccommodations((current) =>
            retainEquivalentValue(
              current,
              (loaded.trip_accommodations as TripAccommodation[]) ?? [],
            ),
          );
          setTripTransportations((current) =>
            retainEquivalentValue(
              current,
              (loaded.trip_transportations as TripTransportation[]) ?? [],
            ),
          );
          setTripFoods((current) =>
            retainEquivalentValue(
              current,
              (loaded.trip_foods as TripFood[]) ?? [],
            ),
          );
          setTripPlaces((current) =>
            retainEquivalentValue(
              current,
              (loaded.trip_places as TripPlace[]) ?? [],
            ),
          );
          setFridge((current) =>
            retainEquivalentValue(
              current,
              (loaded.fridge_items as FridgeItem[]) ?? [],
            ),
          );
          setParking((current) =>
            retainEquivalentValue(
              current,
              ((loaded.parking_records as ParkingRecord[]) ?? [])[0] ?? null,
            ),
          );
          setCacheReadyUser(currentUser);
          setIsDataLoading(false);
        });
      } catch (error) {
        if (!active) return;
        if (!restoredFromCache) {
          setEvents([]);
          setDaysOff([]);
          setTodos([]);
          setShopping([]);
          setTrips([]);
          setTripFlights([]);
          setTripAccommodations([]);
          setTripTransportations([]);
          setTripFoods([]);
          setTripPlaces([]);
          setFridge([]);
          setParking(null);
          setIsDataLoading(false);
        }
        showToast(
          error instanceof Error &&
            error.message === "SUPABASE_NOT_CONFIGURED"
            ? "데이터 연결이 필요합니다."
            : restoredFromCache
              ? "저장된 데이터를 표시 중이에요. 최신 데이터는 나중에 다시 확인할게요."
              : "데이터를 불러오지 못했어요.",
        );
      }
    }

    void loadData();

    return () => {
      active = false;
    };
  }, [applyDataSnapshot, authState, currentUser, showToast]);

  useEffect(() => {
    if (authState !== "ready" || cacheReadyUser !== currentUser) return;
    let active = true;
    fetch(
      `/api/records?resource=calendar_day_backgrounds&user=${currentUser}`,
    )
      .then(async (response) => {
        if (!response.ok) throw new Error("BACKGROUND_LOAD_FAILED");
        return (await response.json()) as CalendarDayBackground[];
      })
      .then((items) => {
        if (active) {
          startTransition(() => {
            setDayBackgrounds((current) =>
              retainEquivalentValue(current, items),
            );
          });
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [authState, cacheReadyUser, currentUser]);

  useEffect(() => {
    if (authState !== "ready" || cacheReadyUser !== currentUser) return;
    let active = true;
    fetch(
      `/api/records?resource=calendar_color_settings&user=${currentUser}`,
    )
      .then(async (response) => {
        if (!response.ok) throw new Error("COLOR_SETTINGS_LOAD_FAILED");
        return (await response.json()) as CalendarColorSettings[];
      })
      .then((rows) => {
        if (!active || !rows[0]) return;
        const next = calendarColorDefaultsFromSettings(rows[0]);
        startTransition(() => {
          setCalendarColorDefaults((current) =>
            retainEquivalentValue(current, next),
          );
        });
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [authState, cacheReadyUser, currentUser]);

  useEffect(() => {
    if (
      authState !== "ready" ||
      cacheReadyUser !== currentUser ||
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
        startTransition(() => {
          setHolidays((items) => {
            const merged = new Map(items.map((item) => [item.date, item]));
            rows.forEach((item) => merged.set(item.date, item));
            const next = [...merged.values()].sort((a, b) =>
              a.date.localeCompare(b.date),
            );
            return retainEquivalentValue(items, next);
          });
        });
      })
      .catch(() => {
        loadedHolidayYears.current.delete(holidayYear);
        showToast("공휴일을 불러오지 못했습니다.");
      });
  }, [authState, cacheReadyUser, currentUser, holidayYear, showToast]);

  useEffect(() => {
    if (
      authState !== "ready" ||
      cacheReadyUser !== currentUser ||
      isDataLoading
    ) {
      return;
    }
    const saveCache = () => {
      void writeOipDataCache(currentUser, currentDataSnapshot).catch(
        () => undefined,
      );
    };
    if ("requestIdleCallback" in window) {
      const idleCallback = window.requestIdleCallback(saveCache, {
        timeout: 5000,
      });
      return () => window.cancelIdleCallback(idleCallback);
    }
    const timer = globalThis.setTimeout(saveCache, 5000);
    return () => globalThis.clearTimeout(timer);
  }, [
    authState,
    cacheReadyUser,
    currentDataSnapshot,
    currentUser,
    isDataLoading,
  ]);

  async function writeRecord(
    method: "POST" | "PATCH" | "DELETE",
    resource: string,
    payload?: Record<string, unknown>,
    id?: string,
    quiet = false,
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
          if (!quiet) showToast("데이터 연결이 필요합니다.");
          return false;
        }
        throw new Error("WRITE_FAILED");
      }
      return true;
    } catch {
      if (!quiet) {
        showToast("저장하지 못했어요. 잠시 후 다시 시도해 주세요.");
      }
      return false;
    }
  }

  async function saveCalendarColorDefaults(next: CalendarColorDefaults) {
    const normalized: CalendarColorDefaults = {
      daeho: validCalendarColor(
        next.daeho,
        FALLBACK_CALENDAR_COLOR_DEFAULTS.daeho,
      ),
      sanghee: validCalendarColor(
        next.sanghee,
        FALLBACK_CALENDAR_COLOR_DEFAULTS.sanghee,
      ),
      shared: validCalendarColor(
        next.shared,
        FALLBACK_CALENDAR_COLOR_DEFAULTS.shared,
      ),
      private: validCalendarColor(
        next.private,
        FALLBACK_CALENDAR_COLOR_DEFAULTS.private,
      ),
    };
    const previous = calendarColorDefaults;
    setCalendarColorDefaults(normalized);
    const saved = await writeRecord(
      "PATCH",
      "calendar_color_settings",
      {
        daeho_color: normalized.daeho,
        sanghee_color: normalized.sanghee,
        shared_color: normalized.shared,
        private_color: normalized.private,
      },
      "calendar",
      true,
    );
    if (!saved) {
      setCalendarColorDefaults(previous);
      showToast("기본색상을 저장하지 못했어요.");
      return false;
    }
    return true;
  }

  function chooseUser(user: UserCode) {
    localStorage.setItem("oip.currentUser", user);
    authenticationRejectedRef.current = false;
    restoredCacheUserRef.current = null;
    loadedHolidayYears.current.clear();
    setCacheReadyUser(null);
    setIsDataLoading(true);
    setCurrentUser(user);
    setAuthState("ready");
  }

  async function signOutDevice() {
    authenticationRejectedRef.current = true;
    restoredCacheUserRef.current = null;
    await removeDevicePushSubscription().catch(() => undefined);
    await clearOipDataCache().catch(() => undefined);
    await fetch("/api/auth", { method: "DELETE" }).catch(() => undefined);
    localStorage.removeItem("oip.currentUser");
    setIsDataLoading(true);
    setAuthState("locked");
  }

  function openEventModal(range?: DateRange) {
    const nextRange = range ?? { start: selectedDate, end: selectedDate };
    setEditingEvent(null);
    setEventRange(nextRange);
    setEventScope("personal");
    setSelectedDate(nextRange.start);
    setModal("event");
  }

  function openEditEvent(item: CalendarEvent) {
    const range = eventDateRange(item);
    setEditingEvent(item);
    setEventRange(range);
    setEventScope(calendarEventScope(item));
    setSelectedDate(range.start);
    setModal("event");
  }

  function saveEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const title = String(form.get("title") ?? "").trim();
    const startDate = String(form.get("start_date") ?? "");
    const endDate = String(form.get("end_date") ?? startDate);
    const startTime = String(form.get("start_time") ?? "");
    const endTime = String(form.get("end_time") ?? "");
    const requestedColor = String(form.get("custom_color") ?? "");
    const customColor = /^#[0-9A-Fa-f]{6}$/.test(requestedColor)
      ? requestedColor
      : null;
    const isShared = eventScope === "shared";
    const isPrivate = eventScope === "private";
    if (!title || !startDate || !endDate || endDate < startDate) return;
    const isAllDay = !startTime && !endTime;
    const previous = editingEvent;
    const next: CalendarEvent = {
      ...(previous ?? {}),
      id: previous?.id ?? newId(),
      title,
      start_at: `${startDate}T${startTime || (isAllDay ? "12:00" : "00:00")}:00+09:00`,
      end_at:
        endDate !== startDate || endTime
          ? `${endDate}T${endTime || "23:59"}:${endTime ? "00" : "59"}+09:00`
          : null,
      is_all_day: isAllDay,
      visibility: isPrivate ? "private" : "shared",
      author_id: previous?.author_id ?? currentUser,
      event_type: "normal",
      color_mode: !isPrivate && !isShared ? "custom" : "default",
      custom_color: customColor,
    };
    setEvents((items) =>
      previous
        ? items.map((item) => (item.id === previous.id ? next : item))
        : [...items, next],
    );
    setSelectedDate(startDate);
    setModal(null);
    setEditingEvent(null);
    void writeRecord(
      previous ? "PATCH" : "POST",
      "calendar_events",
      next,
      previous?.id,
      true,
    ).then((saved) => {
      if (!saved) {
        setEvents((items) =>
          previous
            ? items.map((item) => (item.id === previous.id ? previous : item))
            : items.filter((item) => item.id !== next.id),
        );
        showToast("일정을 저장하지 못했어요. 잠시 후 다시 시도해 주세요.");
      }
    });
  }

  function openDayOffModal(range?: DateRange) {
    const nextRange = range ?? { start: selectedDate, end: selectedDate };
    setDayOffRange(nextRange);
    setSelectedDate(nextRange.start);
    setModal("dayoff");
  }

  function openBackgroundModal(range: DateRange) {
    setBackgroundRange(range);
    setSelectedDate(range.start);
    setModal("day-background");
  }

  function addDayOff(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const startDate = String(form.get("start_date") ?? "");
    const endDate = String(form.get("end_date") ?? startDate);
    const owner = String(form.get("owner") ?? currentUser) as UserCode;
    const type = String(form.get("type") ?? "");
    if (!startDate || !endDate || endDate < startDate || !type) return;
    const existing = new Set(
      daysOff
        .filter((item) => item.owner_id === owner)
        .map((item) => item.date),
    );
    const nextItems: DayOff[] = dateKeysInRange({
      start: startDate,
      end: endDate,
    })
      .filter((date) => !existing.has(date))
      .map((date) => ({
        id: newId(),
        date,
        owner_id: owner,
        day_off_type: type,
        half_day_period: null,
      }));
    if (!nextItems.length) {
      showToast("이미 같은 날짜에 휴무가 있어요.");
      return;
    }
    setDaysOff((items) => [...items, ...nextItems]);
    setSelectedDate(startDate);
    setModal(null);
    void Promise.all(
      nextItems.map((item) =>
        writeRecord("POST", "calendar_days_off", item, undefined, true),
      ),
    ).then((results) => {
      if (!results.every(Boolean)) {
        const ids = new Set(nextItems.map((item) => item.id));
        setDaysOff((items) => items.filter((item) => !ids.has(item.id)));
        showToast("휴무를 모두 저장하지 못했어요.");
      }
    });
  }

  function saveDayBackground(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const color = String(form.get("background_color") ?? "");
    if (
      color &&
      !DAY_BACKGROUND_OPTIONS.some((option) => option.value === color)
    ) {
      return;
    }
    const dates = dateKeysInRange(backgroundRange);
    const dateSet = new Set(dates);
    const previous = dayBackgrounds;
    const existing = new Map(
      dayBackgrounds.map((item) => [item.date, item]),
    );
    const nextItems = color
      ? dates.map<CalendarDayBackground>((date) => ({
          id: existing.get(date)?.id ?? newId(),
          date,
          background_color: color,
          updated_by: currentUser,
        }))
      : [];
    setDayBackgrounds((items) => [
      ...items.filter((item) => !dateSet.has(item.date)),
      ...nextItems,
    ]);
    setModal(null);

    const requests = color
      ? nextItems.map((item) =>
          writeRecord(
            existing.has(item.date) ? "PATCH" : "POST",
            "calendar_day_backgrounds",
            item,
            existing.get(item.date)?.id,
            true,
          ),
        )
      : dates
          .map((date) => existing.get(date))
          .filter((item): item is CalendarDayBackground => Boolean(item))
          .map((item) =>
            writeRecord(
              "DELETE",
              "calendar_day_backgrounds",
              undefined,
              item.id,
              true,
            ),
          );

    void Promise.all(requests).then((results) => {
      if (!results.every(Boolean)) {
        setDayBackgrounds(previous);
        showToast("배경색을 저장하지 못했어요. Supabase 설정을 확인해 주세요.");
      }
    });
  }

  function deleteEvent(item: CalendarEvent) {
    if (!globalThis.confirm(`"${item.title}" 일정을 삭제할까요?`)) return;
    setEvents((items) => items.filter((entry) => entry.id !== item.id));
    void writeRecord(
      "DELETE",
      "calendar_events",
      undefined,
      item.id,
      true,
    ).then((saved) => {
      if (!saved) {
        setEvents((items) => [...items, item]);
        showToast("일정을 삭제하지 못했어요. 잠시 후 다시 시도해 주세요.");
      }
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
    const start = String(form.get("start") ?? "");
    const end = String(form.get("end") ?? "");
    if (!title || !start || !end || end < start) return;
    const next: Trip = {
      id: newId(),
      title,
      destination: title,
      start_date: start,
      end_date: end,
      memo: "",
      author_id: currentUser,
    };
    setTrips((items) => [...items, next]);
    setModal(null);
    void writeRecord("POST", "trips", next);
  }

  function updateTripCountry(item: Trip, countryCode: string) {
    const memoWithoutCountry = composeTripMemo(item.memo, {
      countryCode: null,
    });
    const fallbackMemo = memoWithCountryCode(item.memo, countryCode);
    setTrips((items) =>
      items.map((entry) =>
        entry.id === item.id ? { ...entry, country_code: countryCode } : entry,
      ),
    );
    void writeRecord(
      "PATCH",
      "trips",
      { country_code: countryCode, memo: memoWithoutCountry || null },
      item.id,
      true,
    ).then((savedToCountryColumn) => {
      if (savedToCountryColumn) {
        setTrips((items) =>
          items.map((entry) =>
            entry.id === item.id
              ? { ...entry, memo: memoWithoutCountry || null }
              : entry,
          ),
        );
        return;
      }

      setTrips((items) =>
        items.map((entry) =>
          entry.id === item.id
            ? { ...entry, country_code: countryCode, memo: fallbackMemo }
            : entry,
        ),
      );
      void writeRecord(
        "PATCH",
        "trips",
        { memo: fallbackMemo },
        item.id,
      ).then((savedToMemo) => {
        if (!savedToMemo) {
          setTrips((items) =>
            items.map((entry) => (entry.id === item.id ? item : entry)),
          );
        }
      });
    });
  }

  function updateTripChecklist(item: Trip, checklist: TripChecklistItem[]) {
    const nextMemo = memoWithChecklist(item.memo, checklist);
    setTrips((items) =>
      items.map((entry) =>
        entry.id === item.id ? { ...entry, memo: nextMemo || null } : entry,
      ),
    );
    void writeRecord(
      "PATCH",
      "trips",
      { memo: nextMemo || null },
      item.id,
    ).then((saved) => {
      if (!saved) {
        setTrips((items) =>
          items.map((entry) => (entry.id === item.id ? item : entry)),
        );
      }
    });
  }

  function updateTripMemo(item: Trip, memo: string) {
    const nextMemo = memoWithVisibleText(item.memo, memo);
    setTrips((items) =>
      items.map((entry) =>
        entry.id === item.id ? { ...entry, memo: nextMemo || null } : entry,
      ),
    );
    void writeRecord(
      "PATCH",
      "trips",
      { memo: nextMemo || null },
      item.id,
    ).then((saved) => {
      if (!saved) {
        setTrips((items) =>
          items.map((entry) => (entry.id === item.id ? item : entry)),
        );
      }
    });
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

  if (authState === "checking") return <LoadingScreen />;
  if (authState === "locked") {
    return (
      <PasswordGate
        onToggleTheme={toggleTheme}
        onAuthenticated={() => {
          authenticationRejectedRef.current = false;
          const stored = localStorage.getItem("oip.currentUser");
          if (stored === "daeho" || stored === "sanghee") {
            loadedHolidayYears.current.clear();
            setCacheReadyUser(null);
            setIsDataLoading(true);
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
    <div
      className={`app-shell${isCalendarPage ? " app-shell--calendar" : ""}`}
    >
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
          <button
            aria-label="OIP 새로고침"
            className="mobile-brand"
            onClick={() => globalThis.location.reload()}
            type="button"
          >
            <CloverLogo />
            <strong>OIP</strong>
          </button>
          <div className="app-header-title">
            <h1>{activeTab.title}</h1>
          </div>
          <div className="header-actions">
            <NotificationToggleButton
              onToggle={togglePushNotifications}
              status={pushStatus}
            />
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

        <main
          className={`content${
            mainTab === "schedule" ? " content--calendar" : ""
          }`}
        >
          {isDataLoading ? (
            <DataLoadingSkeleton />
          ) : (
            <>
          {mainTab === "schedule" ? (
            <CalendarView
              backgrounds={dayBackgrounds}
              colorDefaults={calendarColorDefaults}
              daysOff={daysOff}
              events={events}
              holidays={holidays}
              onAddDayOff={openDayOffModal}
              onAddEvent={openEventModal}
              onDeleteDayOff={deleteDayOff}
              onDeleteEvent={deleteEvent}
              onEditEvent={openEditEvent}
              onSetBackground={openBackgroundModal}
              onVisibleYearChange={setHolidayYear}
              selectedDate={selectedDate}
              setSelectedDate={setSelectedDate}
            />
          ) : null}

          {mainTab === "tasks" ? (
            <>
              <div
                className="sub-tabs sub-tabs--tasks"
                role="tablist"
                aria-label="할일 메뉴"
              >
                {(
                  [
                    ["todo", "TODO"],
                    ["shopping", "쇼핑목록"],
                  ] as Array<[TaskTab, string]>
                ).map(([id, label]) => (
                  <button
                    aria-selected={taskTab === id}
                    className={taskTab === id ? "is-active" : ""}
                    key={id}
                    onClick={() => setTaskTab(id)}
                    role="tab"
                    type="button"
                  >
                    {label}
                    {id === "todo" &&
                    todos.filter((item) => !item.is_completed).length
                      ? ` ${todos.filter((item) => !item.is_completed).length}`
                      : ""}
                    {id === "shopping" &&
                    shopping.filter((item) => !item.is_purchased).length
                      ? ` ${shopping.filter((item) => !item.is_purchased).length}`
                      : ""}
                  </button>
                ))}
              </div>
              {taskTab === "todo" ? (
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
              onUpdateChecklist={updateTripChecklist}
              onUpdateCountry={updateTripCountry}
              onUpdateMemo={updateTripMemo}
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
          onClose={() => {
            setModal(null);
            setEditingEvent(null);
          }}
          title={editingEvent ? "일정 수정" : "일정 추가"}
        >
          <EventForm
            colorDefaults={calendarColorDefaults}
            currentUser={
              editingEvent?.author_id === "daeho" ||
              editingEvent?.author_id === "sanghee"
                ? editingEvent.author_id
                : currentUser
            }
            initialEvent={editingEvent}
            initialRange={eventRange}
            key={editingEvent?.id ?? "new-event"}
            onSaveDefaultColors={saveCalendarColorDefaults}
            onSubmit={saveEvent}
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
                <span>시작 날짜 *</span>
                <input
                  defaultValue={dayOffRange.start}
                  name="start_date"
                  required
                  type="date"
                />
              </label>
              <label className="field">
                <span>종료 날짜 *</span>
                <input
                  defaultValue={dayOffRange.end}
                  min={dayOffRange.start}
                  name="end_date"
                  required
                  type="date"
                />
              </label>
            </div>
            <div className="field-row">
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

      {modal === "day-background" ? (
        <Modal
          onClose={() => setModal(null)}
          title="배경색 설정"
        >
          <DayBackgroundForm
            initialColor={
              backgroundRange.start === backgroundRange.end
                ? dayBackgrounds.find(
                    (item) => item.date === backgroundRange.start,
                  )?.background_color ?? ""
                : ""
            }
            onSubmit={saveDayBackground}
            range={backgroundRange}
          />
        </Modal>
      ) : null}

      {modal === "trip" ? (
        <Modal
          onClose={() => setModal(null)}
          title="여행 추가"
        >
          <form className="modal-form" onSubmit={addTrip}>
            <label className="field">
              <span>여행 제목 *</span>
              <input autoFocus name="title" placeholder="예: 가을 교토" required />
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
