export const SESSION_COOKIE = "oip_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 90;

const encoder = new TextEncoder();

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

async function hmac(value: string) {
  const secret =
    process.env.OIP_PASSWORD ||
    (process.env.NODE_ENV === "development"
      ? "oip-local-development-session-secret"
      : "");

  if (!secret) return "";

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(value),
  );
  return bytesToBase64Url(new Uint8Array(signature));
}

function safeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

export async function verifyPassword(password: string) {
  const expected =
    process.env.OIP_PASSWORD ??
    (process.env.NODE_ENV === "development" ? "oip" : "");
  if (!expected) return false;
  return safeEqual(password, expected);
}

export async function createSessionToken() {
  const version = process.env.OIP_SESSION_VERSION ?? "1";
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE;
  const payload = `${version}.${expiresAt}`;
  const signature = await hmac(payload);
  if (!signature) throw new Error("OIP_PASSWORD is not configured.");
  return `${payload}.${signature}`;
}

export async function verifySessionToken(token?: string | null) {
  if (!token) return false;
  const [version, expiresAt, signature, extra] = token.split(".");
  if (!version || !expiresAt || !signature || extra) return false;
  if (version !== (process.env.OIP_SESSION_VERSION ?? "1")) return false;
  if (!Number.isFinite(Number(expiresAt))) return false;
  if (Number(expiresAt) <= Math.floor(Date.now() / 1000)) return false;

  const expected = await hmac(`${version}.${expiresAt}`);
  return Boolean(expected) && safeEqual(signature, expected);
}
