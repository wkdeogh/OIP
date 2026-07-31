import webpush from "web-push";

export type StoredPushSubscription = {
  endpoint: string;
  p256dh: string;
  auth: string;
};

export type PushMessage = {
  title: string;
  body: string;
  date?: string;
  url?: string;
};

export function vapidConfiguration() {
  const publicKey = process.env.VAPID_PUBLIC_KEY ?? "";
  const privateKey = process.env.VAPID_PRIVATE_KEY ?? "";
  const subject = process.env.VAPID_SUBJECT ?? "";
  return {
    configured: Boolean(publicKey && privateKey && subject),
    publicKey,
    privateKey,
    subject,
  };
}

export async function sendWebPush(
  subscription: StoredPushSubscription,
  message: PushMessage,
) {
  const vapid = vapidConfiguration();
  if (!vapid.configured) throw new Error("VAPID_NOT_CONFIGURED");

  return webpush.sendNotification(
    {
      endpoint: subscription.endpoint,
      keys: {
        p256dh: subscription.p256dh,
        auth: subscription.auth,
      },
    },
    JSON.stringify(message),
    {
      TTL: 60 * 60 * 6,
      urgency: "normal",
      topic: message.date
        ? `oip-${message.date.replaceAll("-", "")}`
        : "oip-test",
      vapidDetails: {
        subject: vapid.subject,
        publicKey: vapid.publicKey,
        privateKey: vapid.privateKey,
      },
    },
  );
}

export function isExpiredPushSubscription(error: unknown) {
  const statusCode =
    typeof error === "object" && error !== null && "statusCode" in error
      ? Number(error.statusCode)
      : 0;
  return statusCode === 404 || statusCode === 410;
}
