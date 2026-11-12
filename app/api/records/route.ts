import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";
import { calendarDateKey, parseRecurrenceRule } from "@/lib/calendar-recurrence";
import {
  isResourceName,
  pickAllowedFields,
  recordReadFilters,
  ResourceName,
  supabaseRest,
} from "@/lib/supabase-rest";

async function authorize(request: NextRequest) {
  return verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value);
}

function configurationError(error: unknown) {
  if (error instanceof Error && error.message === "SUPABASE_NOT_CONFIGURED") {
    return NextResponse.json(
      {
        error: "Supabase 연결이 필요합니다.",
        code: "SUPABASE_NOT_CONFIGURED",
      },
      { status: 503 },
    );
  }
  return null;
}

function getResource(request: NextRequest): ResourceName | null {
  const resource = request.nextUrl.searchParams.get("resource") ?? "";
  return isResourceName(resource) ? resource : null;
}

function recurrenceError(resource: ResourceName, payload: Record<string, unknown>) {
  if (resource !== "calendar_events" || payload.recurrence_rule == null || payload.recurrence_rule === "") return null;
  const rule = typeof payload.recurrence_rule === "string"
    ? parseRecurrenceRule(payload.recurrence_rule) : null;
  if (!rule) return NextResponse.json({ error: "지원하지 않는 반복 설정입니다." }, { status: 400 });
  if (rule.until && typeof payload.start_at === "string" && rule.until < calendarDateKey(payload.start_at)) {
    return NextResponse.json({ error: "반복 종료일을 시작 날짜 이후로 설정해 주세요." }, { status: 400 });
  }
  return null;
}

async function proxyResponse(response: Response) {
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    return NextResponse.json(
      { error: "데이터를 처리하지 못했습니다.", detail: payload },
      { status: response.status },
    );
  }
  return NextResponse.json(payload ?? []);
}

export async function GET(request: NextRequest) {
  if (!(await authorize(request))) {
    return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  }
  const resource = getResource(request);
  if (!resource) {
    return NextResponse.json({ error: "지원하지 않는 데이터입니다." }, { status: 400 });
  }

  try {
    const search = recordReadFilters(
      resource,
      request.nextUrl.searchParams,
      request.nextUrl.searchParams.get("user") ?? "",
    );
    return proxyResponse(await supabaseRest(resource, search));
  } catch (error) {
    const configured = configurationError(error);
    if (configured) return configured;
    return NextResponse.json({ error: "요청을 확인해 주세요." }, { status: 400 });
  }
}

export async function POST(request: NextRequest) {
  if (!(await authorize(request))) {
    return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  }
  const resource = getResource(request);
  if (!resource) {
    return NextResponse.json({ error: "지원하지 않는 데이터입니다." }, { status: 400 });
  }

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const payload = pickAllowedFields(resource, body);
    const invalidRecurrence = recurrenceError(resource, payload);
    if (invalidRecurrence) return invalidRecurrence;
    if (Object.keys(payload).length === 0) {
      return NextResponse.json({ error: "저장할 값이 없습니다." }, { status: 400 });
    }
    return proxyResponse(
      await supabaseRest(resource, new URLSearchParams(), {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    );
  } catch (error) {
    const configured = configurationError(error);
    if (configured) return configured;
    return NextResponse.json({ error: "저장하지 못했습니다." }, { status: 400 });
  }
}

export async function PATCH(request: NextRequest) {
  if (!(await authorize(request))) {
    return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  }
  const resource = getResource(request);
  const id = request.nextUrl.searchParams.get("id");
  if (!resource || !id) {
    return NextResponse.json({ error: "수정할 항목이 없습니다." }, { status: 400 });
  }

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const payload = pickAllowedFields(resource, body);
    const invalidRecurrence = recurrenceError(resource, payload);
    if (invalidRecurrence) return invalidRecurrence;
    return proxyResponse(
      await supabaseRest(resource, new URLSearchParams({ id: `eq.${id}` }), {
        method: "PATCH",
        body: JSON.stringify(payload),
      }),
    );
  } catch (error) {
    const configured = configurationError(error);
    if (configured) return configured;
    return NextResponse.json({ error: "수정하지 못했습니다." }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest) {
  if (!(await authorize(request))) {
    return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  }
  const resource = getResource(request);
  const id = request.nextUrl.searchParams.get("id");
  if (!resource || !id) {
    return NextResponse.json({ error: "삭제할 항목이 없습니다." }, { status: 400 });
  }

  try {
    return proxyResponse(
      await supabaseRest(resource, new URLSearchParams({ id: `eq.${id}` }), {
        method: "DELETE",
      }),
    );
  } catch (error) {
    const configured = configurationError(error);
    if (configured) return configured;
    return NextResponse.json({ error: "삭제하지 못했습니다." }, { status: 400 });
  }
}
