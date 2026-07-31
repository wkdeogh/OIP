import { NextRequest, NextResponse } from "next/server";
import type { UserCode } from "@/app/oip-types";
import {
  calendarReminderPayload,
  type CalendarReminderEvent,
  seoulDateKey,
  seoulDayBounds,
  systemAnniversariesForDate,
  visibleReminderEvents,
} from "@/lib/calendar-reminders";
import { supabaseTableRest } from "@/lib/supabase-rest";
import {
  isExpiredPushSubscription,
  sendWebPush,
  vapidConfiguration,
} from "@/lib/web-push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PushSubscriptionRow = {
  id: string;
  user_code: UserCode;
  endpoint: string;
  p256dh: string;
  auth: string;
};

type DeliveryClaim = { id: string };

async function responseJson<T>(response: Response) {
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`SUPABASE_REQUEST_FAILED:${response.status}`);
  }
  return payload as T;
}

async function loadTodayEvents(dateKey: string) {
  const bounds = seoulDayBounds(dateKey);
  const search = new URLSearchParams({
    select:
      "id,title,start_at,end_at,is_all_day,visibility,author_id,event_type",
    start_at: `lt.${bounds.end}`,
    or: `(end_at.gte.${bounds.start},start_at.gte.${bounds.start})`,
    order: "start_at.asc",
  });
  const response = await supabaseTableRest("calendar_events", search);
  const events = await responseJson<CalendarReminderEvent[]>(response);
  return [...events, ...systemAnniversariesForDate(dateKey)];
}

async function loadSubscriptions() {
  const response = await supabaseTableRest(
    "push_subscriptions",
    new URLSearchParams({
      select: "id,user_code,endpoint,p256dh,auth",
      order: "created_at.asc",
    }),
  );
  return responseJson<PushSubscriptionRow[]>(response);
}

async function claimDelivery(subscriptionId: string, dateKey: string) {
  const response = await supabaseTableRest(
    "push_delivery_log",
    new URLSearchParams({ on_conflict: "subscription_id,delivery_date" }),
    {
      method: "POST",
      headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
      body: JSON.stringify({
        subscription_id: subscriptionId,
        delivery_date: dateKey,
        status: "pending",
      }),
    },
  );
  const claims = await responseJson<DeliveryClaim[]>(response);
  return claims[0] ?? null;
}

async function markDeliverySent(claimId: string) {
  const response = await supabaseTableRest(
    "push_delivery_log",
    new URLSearchParams({ id: `eq.${claimId}` }),
    {
      method: "PATCH",
      body: JSON.stringify({
        status: "sent",
        sent_at: new Date().toISOString(),
      }),
    },
  );
  if (!response.ok) throw new Error("DELIVERY_LOG_UPDATE_FAILED");
}

async function deleteRow(
  table: "push_subscriptions" | "push_delivery_log",
  id: string,
) {
  const response = await supabaseTableRest(
    table,
    new URLSearchParams({ id: `eq.${id}` }),
    { method: "DELETE" },
  );
  if (!response.ok) throw new Error("ROW_DELETE_FAILED");
}

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET ?? "";
  if (
    !cronSecret ||
    request.headers.get("authorization") !== `Bearer ${cronSecret}`
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!vapidConfiguration().configured) {
    return NextResponse.json(
      { error: "VAPID configuration is missing." },
      { status: 503 },
    );
  }

  try {
    const dateKey = seoulDateKey(new Date());
    const [events, subscriptions] = await Promise.all([
      loadTodayEvents(dateKey),
      loadSubscriptions(),
    ]);
    let sent = 0;
    let skipped = 0;
    let failed = 0;
    let removed = 0;

    for (const subscription of subscriptions) {
      if (
        subscription.user_code !== "daeho" &&
        subscription.user_code !== "sanghee"
      ) {
        skipped += 1;
        continue;
      }
      const visibleEvents = visibleReminderEvents(
        events,
        subscription.user_code,
      );
      if (visibleEvents.length === 0) {
        skipped += 1;
        continue;
      }

      const claim = await claimDelivery(subscription.id, dateKey);
      if (!claim) {
        skipped += 1;
        continue;
      }

      try {
        await sendWebPush(
          {
            endpoint: subscription.endpoint,
            p256dh: subscription.p256dh,
            auth: subscription.auth,
          },
          calendarReminderPayload(visibleEvents, dateKey),
        );
        await markDeliverySent(claim.id);
        sent += 1;
      } catch (error) {
        failed += 1;
        if (isExpiredPushSubscription(error)) {
          await deleteRow("push_subscriptions", subscription.id);
          removed += 1;
        } else {
          await deleteRow("push_delivery_log", claim.id);
        }
      }
    }

    return NextResponse.json({
      date: dateKey,
      events: events.length,
      subscriptions: subscriptions.length,
      sent,
      skipped,
      failed,
      removed,
    });
  } catch (error) {
    console.error("Calendar reminder cron failed", error);
    return NextResponse.json(
      { error: "Calendar reminders could not be sent." },
      { status: 500 },
    );
  }
}
