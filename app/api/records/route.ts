import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";
import {
  isResourceName,
  pickAllowedFields,
  resourceConfigs,
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

function applyReadFilters(
  resource: ResourceName,
  source: URLSearchParams,
  currentUser: string,
) {
  const search = new URLSearchParams({ select: "*" });
  const order = resourceConfigs[resource].order;
  if (order) search.set("order", order);

  if (resource === "calendar_events" || resource === "todos") {
    if (currentUser !== "daeho" && currentUser !== "sanghee") {
      throw new Error("INVALID_USER");
    }
    search.set("or", `(visibility.eq.shared,author_id.eq.${currentUser})`);
  }
  if (resource === "fridge_items") search.set("consumed_at", "is.null");
  if (resource === "parking_records") search.set("limit", "1");
  if (resource.startsWith("trip_")) {
    const tripId = source.get("trip_id");
    if (tripId) search.set("trip_id", `eq.${tripId}`);
  }

  const id = source.get("id");
  if (id) search.set("id", `eq.${id}`);
  return search;
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
    const search = applyReadFilters(
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
