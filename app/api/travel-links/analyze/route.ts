import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";

const MAX_URL_LENGTH = 2048;
const MAX_SCREENSHOTS = 4;
const MAX_SCREENSHOT_BYTES = 7 * 1024 * 1024;
const MAX_SCREENSHOT_TOTAL_BYTES = 20 * 1024 * 1024;
const MAX_PAGE_TEXT_LENGTH = 14_000;
const SUPPORTED_IMAGE_TYPES = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

type LinkMetadata = {
  url: string;
  canonicalUrl: string;
  platform: string;
  title: string;
  authorName: string | null;
  thumbnailUrl: string | null;
  description: string;
  pageText: string;
};

type OpenAiResponse = {
  error?: { message?: string };
  output?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string }>;
  }>;
};

function jsonError(message: string, status: number, code: string) {
  return NextResponse.json({ error: message, code }, { status });
}

function blockedHostname(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    return true;
  }
  if (host === "::1" || host.startsWith("fc") || host.startsWith("fd")) {
    return true;
  }
  const parts = host.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d+$/.test(part))) {
    return false;
  }
  const numbers = parts.map(Number);
  if (numbers.some((part) => part < 0 || part > 255)) return true;
  return (
    numbers[0] === 0 ||
    numbers[0] === 10 ||
    numbers[0] === 127 ||
    (numbers[0] === 169 && numbers[1] === 254) ||
    (numbers[0] === 172 && numbers[1] >= 16 && numbers[1] <= 31) ||
    (numbers[0] === 192 && numbers[1] === 168) ||
    numbers[0] >= 224
  );
}

function validateUrl(value: string) {
  if (!value || value.length > MAX_URL_LENGTH) throw new Error("INVALID_URL");
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error("INVALID_URL");
  }
  if (blockedHostname(url.hostname)) throw new Error("BLOCKED_URL");
  return url;
}

async function safeFetch(input: URL, init?: RequestInit) {
  let url = input;
  for (let redirectCount = 0; redirectCount <= 3; redirectCount += 1) {
    validateUrl(url.toString());
    const response = await fetch(url, {
      ...init,
      redirect: "manual",
      signal: AbortSignal.timeout(9_000),
      headers: {
        "User-Agent": "OIP Travel Link Analyzer/1.0",
        Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.5",
        ...(init?.headers ?? {}),
      },
    });
    if (response.status < 300 || response.status >= 400) return response;
    const location = response.headers.get("location");
    if (!location) return response;
    url = validateUrl(new URL(location, url).toString());
  }
  throw new Error("TOO_MANY_REDIRECTS");
}

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCodePoint(Number(code)),
    );
}

function cleanText(value: string, limit = MAX_PAGE_TEXT_LENGTH) {
  return decodeHtml(value)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 32_768) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
  }
  return btoa(binary);
}

function metaContent(html: string, key: string) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(
      `<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']*)["'][^>]*>`,
      "i",
    ),
    new RegExp(
      `<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`,
      "i",
    ),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern)?.[1];
    if (match) return cleanText(match, 1000);
  }
  return "";
}

function pageTitle(html: string) {
  return (
    metaContent(html, "og:title") ||
    metaContent(html, "twitter:title") ||
    cleanText(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "", 300)
  );
}

function canonicalHref(html: string, baseUrl: URL) {
  const href = html.match(
    /<link[^>]+rel=["'][^"']*canonical[^"']*["'][^>]+href=["']([^"']+)["'][^>]*>/i,
  )?.[1];
  if (!href) return baseUrl.toString();
  try {
    return validateUrl(new URL(decodeHtml(href), baseUrl).toString()).toString();
  } catch {
    return baseUrl.toString();
  }
}

function platformFor(url: URL) {
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (host === "youtu.be" || host.endsWith("youtube.com")) return "youtube";
  if (host.endsWith("tiktok.com")) return "tiktok";
  if (host.endsWith("instagram.com")) return "instagram";
  if (host.endsWith("google.com") || host.endsWith("goo.gl")) return "google-maps";
  return "web";
}

function fallbackMetadata(rawUrl: string): LinkMetadata {
  const url = validateUrl(rawUrl);
  return {
    url: url.toString(),
    canonicalUrl: url.toString(),
    platform: platformFor(url),
    title: url.hostname.replace(/^www\./, ""),
    authorName: null,
    thumbnailUrl: null,
    description: "",
    pageText: "",
  };
}

async function oEmbedMetadata(url: URL, platform: string) {
  const endpoint =
    platform === "youtube"
      ? new URL("https://www.youtube.com/oembed")
      : platform === "tiktok"
        ? new URL("https://www.tiktok.com/oembed")
        : null;
  if (!endpoint) return null;
  endpoint.searchParams.set("url", url.toString());
  if (platform === "youtube") endpoint.searchParams.set("format", "json");
  try {
    const response = await safeFetch(endpoint);
    if (!response.ok) return null;
    const data = (await response.json()) as Record<string, unknown>;
    return {
      title: cleanText(String(data.title ?? ""), 500),
      authorName: cleanText(String(data.author_name ?? ""), 200) || null,
      thumbnailUrl:
        typeof data.thumbnail_url === "string" ? data.thumbnail_url : null,
    };
  } catch {
    return null;
  }
}

async function collectMetadata(rawUrl: string): Promise<LinkMetadata> {
  const requestedUrl = validateUrl(rawUrl);
  const platform = platformFor(requestedUrl);
  const oEmbed = await oEmbedMetadata(requestedUrl, platform);

  if (oEmbed) {
    return {
      url: requestedUrl.toString(),
      canonicalUrl: requestedUrl.toString(),
      platform,
      title: oEmbed.title || requestedUrl.hostname,
      authorName: oEmbed.authorName,
      thumbnailUrl: oEmbed.thumbnailUrl,
      description: oEmbed.title,
      pageText: "",
    };
  }

  const response = await safeFetch(requestedUrl);
  if (!response.ok) throw new Error("LINK_FETCH_FAILED");
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("text/html") && !contentType.includes("text/plain")) {
    throw new Error("UNSUPPORTED_LINK_CONTENT");
  }
  const html = (await response.text()).slice(0, 1_500_000);
  const finalUrl = validateUrl(response.url || requestedUrl.toString());
  const description =
    metaContent(html, "og:description") ||
    metaContent(html, "description") ||
    metaContent(html, "twitter:description");
  const bodyText = cleanText(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  );

  return {
    url: requestedUrl.toString(),
    canonicalUrl: canonicalHref(html, finalUrl),
    platform,
    title: pageTitle(html) || finalUrl.hostname,
    authorName:
      metaContent(html, "author") || metaContent(html, "article:author") || null,
    thumbnailUrl:
      metaContent(html, "og:image") || metaContent(html, "twitter:image") || null,
    description,
    pageText: bodyText,
  };
}

function outputText(response: OpenAiResponse) {
  for (const item of response.output ?? []) {
    if (item.type !== "message") continue;
    for (const content of item.content ?? []) {
      if (content.type === "output_text" && content.text) return content.text;
    }
  }
  return "";
}

function normalizedAnalysis(value: unknown) {
  if (!value || typeof value !== "object") throw new Error("INVALID_AI_RESULT");
  const result = value as {
    title?: unknown;
    summary?: unknown;
    places?: unknown;
  };
  const places = Array.isArray(result.places) ? result.places : [];
  const seen = new Set<string>();
  return {
    title: cleanText(String(result.title ?? ""), 300),
    summary: cleanText(String(result.summary ?? ""), 800),
    places: places
      .map((entry) => {
        const place = entry as Record<string, unknown>;
        const name = cleanText(String(place.name ?? ""), 180);
        const translatedName = cleanText(
          String(place.translated_name ?? ""),
          180,
        );
        const locationQuery = cleanText(String(place.location_query ?? ""), 400);
        return {
          name,
          translated_name:
            translatedName && translatedName !== name ? translatedName : "",
          city: cleanText(String(place.city ?? ""), 120),
          country: cleanText(String(place.country ?? ""), 120),
          category: cleanText(String(place.category ?? "기타"), 80) || "기타",
          address: cleanText(String(place.address ?? ""), 300),
          location_query: locationQuery || name,
          evidence: cleanText(String(place.evidence ?? ""), 500),
          confidence: Math.min(1, Math.max(0, Number(place.confidence) || 0)),
        };
      })
      .filter((place) => {
        if (!place.name || !place.location_query) return false;
        const key = `${place.name}:${place.location_query}`.toLocaleLowerCase("ko-KR");
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 20),
  };
}

async function analyzeWithOpenAi(metadata: LinkMetadata, screenshots: File[]) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_NOT_CONFIGURED");
  const content: Array<Record<string, unknown>> = [
    {
      type: "input_text",
      text: [
        `원본 URL: ${metadata.url}`,
        `플랫폼: ${metadata.platform}`,
        `제목: ${metadata.title}`,
        `작성자: ${metadata.authorName ?? "알 수 없음"}`,
        `설명: ${metadata.description || "없음"}`,
        `페이지 텍스트: ${metadata.pageText || "없음"}`,
        `첨부 스크린샷 수: ${screenshots.length}`,
      ].join("\n"),
    },
  ];

  for (const screenshot of screenshots) {
    const base64 = arrayBufferToBase64(await screenshot.arrayBuffer());
    content.push({
      type: "input_image",
      image_url: `data:${screenshot.type};base64,${base64}`,
      detail: "original",
    });
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    signal: AbortSignal.timeout(60_000),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_TRAVEL_MODEL || "gpt-5.6-sol",
      store: false,
      reasoning: { effort: "low" },
      max_output_tokens: 2400,
      instructions:
        "여행 콘텐츠 분석기다. 링크 메타데이터와 첨부 스크린샷에 명시적으로 나타난 실제 방문 가능한 장소만 추출한다. 화면의 간판, 주소, 자막과 본문을 함께 사용하되 근거가 없는 장소는 추측하지 않는다. 같은 장소는 하나로 합친다. title은 콘텐츠를 식별할 수 있는 짧은 한국어 제목으로 작성하고, location_query는 Google 지도에서 검색하기 좋은 '장소명 도시 국가' 형태로 작성한다. category는 식당, 카페, 관광, 쇼핑, 숙소, 기타 중 가장 알맞은 하나를 선택한다. 장소의 원래 name이 한국어나 영어가 아닌 다른 언어 문자로 되어 있으면 translated_name에 널리 쓰이는 한국어 명칭이나 자연스러운 한국어 음역을 작성한다. 원래 name이 한국어 또는 영어이면 translated_name은 빈 문자열로 반환한다. summary와 evidence는 한국어로 쓴다. 장소가 확인되지 않으면 places를 빈 배열로 반환한다.",
      input: [{ role: "user", content }],
      text: {
        format: {
          type: "json_schema",
          name: "travel_link_analysis",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              title: { type: "string" },
              summary: { type: "string" },
              places: {
                type: "array",
                maxItems: 20,
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    name: { type: "string" },
                    translated_name: { type: "string" },
                    city: { type: "string" },
                    country: { type: "string" },
                    category: {
                      type: "string",
                      enum: ["식당", "카페", "관광", "쇼핑", "숙소", "기타"],
                    },
                    address: { type: "string" },
                    location_query: { type: "string" },
                    evidence: { type: "string" },
                    confidence: { type: "number", minimum: 0, maximum: 1 },
                  },
                  required: [
                    "name",
                    "translated_name",
                    "city",
                    "country",
                    "category",
                    "address",
                    "location_query",
                    "evidence",
                    "confidence",
                  ],
                },
              },
            },
            required: ["title", "summary", "places"],
          },
        },
      },
    }),
  });
  const data = (await response.json().catch(() => ({}))) as OpenAiResponse;
  if (!response.ok) throw new Error("OPENAI_REQUEST_FAILED");
  const text = outputText(data);
  if (!text) throw new Error("EMPTY_AI_RESULT");
  return normalizedAnalysis(JSON.parse(text) as unknown);
}

export async function POST(request: NextRequest) {
  if (!(await verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value))) {
    return jsonError("인증이 필요합니다.", 401, "UNAUTHORIZED");
  }

  try {
    const formData = await request.formData();
    const rawUrl = String(formData.get("url") ?? "").trim();
    const screenshots = formData
      .getAll("screenshots")
      .filter((value): value is File => value instanceof File && value.size > 0);
    if (screenshots.length > MAX_SCREENSHOTS) {
      return jsonError("스크린샷은 최대 4장까지 첨부할 수 있습니다.", 400, "TOO_MANY_IMAGES");
    }
    if (
      screenshots.some(
        (file) =>
          !SUPPORTED_IMAGE_TYPES.has(file.type) || file.size > MAX_SCREENSHOT_BYTES,
      ) ||
      screenshots.reduce((total, file) => total + file.size, 0) >
        MAX_SCREENSHOT_TOTAL_BYTES
    ) {
      return jsonError(
        "스크린샷 형식이나 용량을 확인해 주세요.",
        400,
        "INVALID_IMAGE",
      );
    }

    let metadata: LinkMetadata;
    try {
      metadata = await collectMetadata(rawUrl);
    } catch (error) {
      if (!screenshots.length) throw error;
      metadata = fallbackMetadata(rawUrl);
    }
    const analysis = await analyzeWithOpenAi(metadata, screenshots);
    return NextResponse.json({
      source: {
        url: metadata.url,
        canonical_url: metadata.canonicalUrl,
        platform: metadata.platform,
        title: analysis.title || metadata.title,
        author_name: metadata.authorName,
        thumbnail_url: metadata.thumbnailUrl,
        summary: analysis.summary,
      },
      places: analysis.places,
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "ANALYSIS_FAILED";
    if (code === "OPENAI_NOT_CONFIGURED") {
      return jsonError("OpenAI API 키 설정이 필요합니다.", 503, code);
    }
    if (code === "INVALID_URL" || code === "BLOCKED_URL") {
      return jsonError("분석할 수 있는 공개 URL을 입력해 주세요.", 400, code);
    }
    if (
      code === "LINK_FETCH_FAILED" ||
      code === "UNSUPPORTED_LINK_CONTENT" ||
      code === "TOO_MANY_REDIRECTS"
    ) {
      return jsonError(
        "링크 내용을 읽지 못했습니다. 공개 링크인지 확인해 주세요.",
        422,
        code,
      );
    }
    return jsonError(
      "AI 분석을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.",
      502,
      code,
    );
  }
}
