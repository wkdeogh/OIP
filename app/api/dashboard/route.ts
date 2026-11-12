import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";
import { DASHBOARD_RESOURCES, type DashboardPayload } from "@/lib/dashboard-sync";
import { recordReadFilters, supabaseRest } from "@/lib/supabase-rest";

export async function GET(request: NextRequest) {
  const headers = { "Cache-Control": "private, no-store" };
  if (!(await verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value))) {
    return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401, headers });
  }
  const user = request.nextUrl.searchParams.get("user");
  if (user !== "daeho" && user !== "sanghee") {
    return NextResponse.json({ error: "사용자를 확인해 주세요." }, { status: 400, headers });
  }

  const results = await Promise.allSettled(DASHBOARD_RESOURCES.map(async (resource) => {
    const response = await supabaseRest(
      resource,
      recordReadFilters(resource, new URLSearchParams(), user),
      { signal: AbortSignal.timeout(12_000) },
    );
    if (!response.ok) throw new Error("DASHBOARD_READ_FAILED");
    const rows: unknown = await response.json();
    if (!Array.isArray(rows)) throw new Error("INVALID_DASHBOARD_DATA");
    return rows;
  }));
  const payload: DashboardPayload = { records: {}, failedResources: [] };
  results.forEach((result, index) => {
    const resource = DASHBOARD_RESOURCES[index];
    if (result.status === "fulfilled") payload.records[resource] = result.value;
    else payload.failedResources.push(resource);
  });
  return NextResponse.json(payload, { headers });
}
