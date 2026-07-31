import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";
import { supabaseTableRest } from "@/lib/supabase-rest";
import {
  isExpiredPushSubscription,
  sendWebPush,
  vapidConfiguration,
} from "@/lib/web-push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SubscriptionRequest = {
  user_code?: unknown;
  endpoint?: unknown;
  expirationTime?: unknown;
  keys?: {
    p256dh?: unknown;
    auth?: unknown;
  };
  send_test?: unknown;
};

async function authorize(request: NextRequest) {
  return verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value);
}

function isUserCode(value: unknown): value is "daeho" | "sanghee" {
  return value === "daeho" || value === "sanghee";
}

function validSubscription(body: SubscriptionRequest) {
  return (
    isUserCode(body.user_code) &&
    typeof body.endpoint === "string" &&
    body.endpoint.startsWith("https://") &&
    body.endpoint.length <= 4096 &&
    typeof body.keys?.p256dh === "string" &&
    body.keys.p256dh.length <= 512 &&
    typeof body.keys?.auth === "string" &&
    body.keys.auth.length <= 256
  );
}

async function deleteEndpoint(endpoint: string) {
  return supabaseTableRest(
    "push_subscriptions",
    new URLSearchParams({ endpoint: `eq.${endpoint}` }),
    { method: "DELETE" },
  );
}

export async function GET(request: NextRequest) {
  if (!(await authorize(request))) {
    return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  }
  const vapid = vapidConfiguration();
  return NextResponse.json(
    {
      configured: vapid.configured,
      publicKey: vapid.configured ? vapid.publicKey : null,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: NextRequest) {
  if (!(await authorize(request))) {
    return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  }
  const vapid = vapidConfiguration();
  if (!vapid.configured) {
    return NextResponse.json(
      { error: "푸시 알림 서버 설정이 필요합니다." },
      { status: 503 },
    );
  }

  try {
    const body = (await request.json()) as SubscriptionRequest;
    if (!validSubscription(body)) {
      return NextResponse.json(
        { error: "푸시 구독 정보를 확인해 주세요." },
        { status: 400 },
      );
    }

    const endpoint = body.endpoint as string;
    const p256dh = body.keys?.p256dh as string;
    const auth = body.keys?.auth as string;
    const response = await supabaseTableRest(
      "push_subscriptions",
      new URLSearchParams({ on_conflict: "endpoint" }),
      {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=representation" },
        body: JSON.stringify({
          user_code: body.user_code,
          endpoint,
          p256dh,
          auth,
          user_agent: request.headers.get("user-agent")?.slice(0, 500) ?? null,
          updated_at: new Date().toISOString(),
        }),
      },
    );
    if (!response.ok) {
      throw new Error(`SUBSCRIPTION_SAVE_FAILED:${response.status}`);
    }

    let testSent = false;
    if (body.send_test === true) {
      try {
        await sendWebPush(
          { endpoint, p256dh, auth },
          {
            title: "OIP 일정 알림",
            body: "매일 오전 8시, 오늘 일정이 있을 때 알려드릴게요.",
            url: "/",
          },
        );
        testSent = true;
      } catch (error) {
        const expired = isExpiredPushSubscription(error);
        if (expired) await deleteEndpoint(endpoint);
        return NextResponse.json(
          {
            saved: !expired,
            testSent: false,
            error: "테스트 알림 전송에 실패했습니다.",
          },
          { status: 502 },
        );
      }
    }

    return NextResponse.json({ saved: true, testSent });
  } catch (error) {
    const isConfigurationError =
      error instanceof Error && error.message === "SUPABASE_NOT_CONFIGURED";
    return NextResponse.json(
      {
        error: isConfigurationError
          ? "Supabase 연결이 필요합니다."
          : "푸시 구독을 저장하지 못했습니다.",
      },
      { status: isConfigurationError ? 503 : 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  if (!(await authorize(request))) {
    return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  }

  try {
    const body = (await request.json()) as { endpoint?: unknown };
    if (typeof body.endpoint !== "string" || !body.endpoint) {
      return NextResponse.json(
        { error: "해제할 푸시 구독이 없습니다." },
        { status: 400 },
      );
    }
    const response = await deleteEndpoint(body.endpoint);
    if (!response.ok) throw new Error("SUBSCRIPTION_DELETE_FAILED");
    return NextResponse.json({ deleted: true });
  } catch (error) {
    const isConfigurationError =
      error instanceof Error && error.message === "SUPABASE_NOT_CONFIGURED";
    return NextResponse.json(
      { error: "푸시 구독을 해제하지 못했습니다." },
      { status: isConfigurationError ? 503 : 500 },
    );
  }
}
