import { NextRequest, NextResponse } from "next/server";
import {
  createSessionToken,
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  verifyPassword,
  verifySessionToken,
} from "@/lib/auth";

type Attempt = { failures: number; blockedUntil: number };
const attempts = new Map<string, Attempt>();

function clientKey(request: NextRequest) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "local"
  );
}

function setSessionCookie(response: NextResponse, token: string) {
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
}

export async function GET(request: NextRequest) {
  const isAuthenticated = await verifySessionToken(
    request.cookies.get(SESSION_COOKIE)?.value,
  );
  const response = NextResponse.json({ authenticated: isAuthenticated });

  if (isAuthenticated) {
    setSessionCookie(response, await createSessionToken());
  }
  return response;
}

export async function POST(request: NextRequest) {
  const key = clientKey(request);
  const now = Date.now();
  const attempt = attempts.get(key);
  if (attempt && attempt.blockedUntil > now) {
    return NextResponse.json(
      {
        error: "잠시 후 다시 시도해 주세요.",
        retryAfter: Math.ceil((attempt.blockedUntil - now) / 1000),
      },
      { status: 429 },
    );
  }

  let password = "";
  try {
    const body = (await request.json()) as { password?: unknown };
    password = typeof body.password === "string" ? body.password : "";
  } catch {
    return NextResponse.json(
      { error: "비밀번호를 입력해 주세요." },
      { status: 400 },
    );
  }

  if (!(await verifyPassword(password))) {
    const failures = (attempt?.failures ?? 0) + 1;
    attempts.set(key, {
      failures,
      blockedUntil: failures >= 5 ? now + 30_000 : 0,
    });
    return NextResponse.json(
      { error: "비밀번호가 맞지 않습니다." },
      { status: 401 },
    );
  }

  attempts.delete(key);
  const response = NextResponse.json({ authenticated: true });
  setSessionCookie(response, await createSessionToken());
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ authenticated: false });
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}
