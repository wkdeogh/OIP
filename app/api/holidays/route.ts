import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";
import { supabaseRest } from "@/lib/supabase-rest";

type HolidayRow = {
  date: string;
  name: string;
  is_holiday: boolean;
  source: string;
  synced_at?: string;
};

type KasiHoliday = {
  dateName?: string;
  isHoliday?: string;
  locdate?: number | string;
};

async function readYear(year: number) {
  const search = new URLSearchParams({
    select: "*",
    and: `(date.gte.${year}-01-01,date.lte.${year}-12-31)`,
    order: "date.asc",
  });
  const response = await supabaseRest("public_holidays", search);
  if (!response.ok) throw new Error("HOLIDAY_READ_FAILED");
  return (await response.json()) as HolidayRow[];
}

function needsRefresh(rows: HolidayRow[]) {
  if (!rows.length) return true;
  const latest = rows.reduce(
    (value, row) =>
      row.synced_at && row.synced_at > value ? row.synced_at : value,
    "",
  );
  if (!latest) return true;
  return Date.now() - new Date(latest).getTime() > 28 * 86_400_000;
}

async function fetchKasiYear(year: number) {
  const apiKey = process.env.PUBLIC_HOLIDAY_API_KEY;
  if (!apiKey) return [];

  const url = new URL(
    "https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo",
  );
  url.searchParams.set("serviceKey", apiKey);
  url.searchParams.set("solYear", String(year));
  url.searchParams.set("numOfRows", "100");
  url.searchParams.set("_type", "json");

  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error("HOLIDAY_API_FAILED");
  const payload = (await response.json()) as {
    response?: {
      header?: { resultCode?: string };
      body?: { items?: { item?: KasiHoliday | KasiHoliday[] } };
    };
  };
  if (payload.response?.header?.resultCode !== "00") {
    throw new Error("HOLIDAY_API_FAILED");
  }

  const raw = payload.response.body?.items?.item;
  const items = raw ? (Array.isArray(raw) ? raw : [raw]) : [];
  const syncedAt = new Date().toISOString();
  const holidays = items
    .filter((item) => item.isHoliday === "Y" && item.locdate && item.dateName)
    .map((item) => {
      const date = String(item.locdate);
      return {
        date: `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`,
        name: item.dateName as string,
        is_holiday: true,
        source: "KASI",
        synced_at: syncedAt,
      } satisfies HolidayRow;
    });
  const deduplicated = new Map<string, HolidayRow>();
  holidays.forEach((holiday) => {
    const existing = deduplicated.get(holiday.date);
    deduplicated.set(
      holiday.date,
      existing
        ? { ...holiday, name: `${existing.name} · ${holiday.name}` }
        : holiday,
    );
  });
  return [...deduplicated.values()];
}

async function syncYear(year: number) {
  const items = await fetchKasiYear(year);
  if (!items.length) return;

  const response = await supabaseRest(
    "public_holidays",
    new URLSearchParams({ on_conflict: "date" }),
    {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify(items),
    },
  );
  if (!response.ok) throw new Error("HOLIDAY_SYNC_FAILED");
}

export async function GET(request: NextRequest) {
  if (
    !(await verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value))
  ) {
    return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  }

  const currentYear = new Date().getFullYear();
  const requested = Number(request.nextUrl.searchParams.get("year"));
  const year =
    Number.isInteger(requested) &&
    requested >= currentYear - 5 &&
    requested <= currentYear + 10
      ? requested
      : currentYear;

  try {
    let rows = await readYear(year);
    if (needsRefresh(rows) && process.env.PUBLIC_HOLIDAY_API_KEY) {
      try {
        await syncYear(year);
        rows = await readYear(year);
      } catch {
        // 마지막으로 저장된 공휴일이 있으면 외부 API 장애 시에도 그대로 사용합니다.
      }
    }
    return NextResponse.json(rows);
  } catch {
    return NextResponse.json(
      { error: "공휴일을 불러오지 못했습니다." },
      { status: 502 },
    );
  }
}
