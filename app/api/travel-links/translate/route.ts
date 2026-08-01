import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";

const MAX_PLACES = 20;
const MAX_NAME_LENGTH = 180;

type OpenAiResponse = {
  output?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string }>;
  }>;
};

function outputText(response: OpenAiResponse) {
  for (const item of response.output ?? []) {
    if (item.type !== "message") continue;
    for (const content of item.content ?? []) {
      if (content.type === "output_text" && content.text) return content.text;
    }
  }
  return "";
}

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: NextRequest) {
  if (!(await verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value))) {
    return errorResponse("인증이 필요합니다.", 401);
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return errorResponse("OpenAI API 키 설정이 필요합니다.", 503);

  const body = (await request.json().catch(() => null)) as {
    places?: unknown;
  } | null;
  if (!Array.isArray(body?.places) || body.places.length > MAX_PLACES) {
    return errorResponse("번역할 장소 목록을 확인해 주세요.", 400);
  }

  const places = body.places
    .map((value) => {
      const place = value as { id?: unknown; name?: unknown };
      return {
        id: String(place.id ?? "").trim(),
        name: String(place.name ?? "").trim().slice(0, MAX_NAME_LENGTH),
      };
    })
    .filter((place) => place.id && place.name);
  if (!places.length) return NextResponse.json({ translations: [] });

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      signal: AbortSignal.timeout(30_000),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OPENAI_TRAVEL_MODEL || "gpt-5.6-sol",
        store: false,
        reasoning: { effort: "low" },
        max_output_tokens: 1200,
        instructions:
          "여행 장소명 번역기다. 각 id는 그대로 유지한다. 일본어, 중국어, 러시아어 등 한국어나 영어가 아닌 장소명을 널리 쓰이는 한국어 명칭으로 번역하거나 자연스럽게 음역한다. 설명을 덧붙이지 말고 translated_name에는 장소명만 쓴다.",
        input: [
          {
            role: "user",
            content: JSON.stringify(places),
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "travel_place_translations",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                translations: {
                  type: "array",
                  maxItems: MAX_PLACES,
                  items: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      id: { type: "string" },
                      translated_name: { type: "string" },
                    },
                    required: ["id", "translated_name"],
                  },
                },
              },
              required: ["translations"],
            },
          },
        },
      }),
    });
    const data = (await response.json().catch(() => ({}))) as OpenAiResponse;
    if (!response.ok) throw new Error("OPENAI_REQUEST_FAILED");
    const text = outputText(data);
    if (!text) throw new Error("EMPTY_AI_RESULT");
    const result = JSON.parse(text) as {
      translations?: Array<{ id?: unknown; translated_name?: unknown }>;
    };
    const requestedIds = new Set(places.map((place) => place.id));
    const translations = (result.translations ?? [])
      .map((item) => ({
        id: String(item.id ?? "").trim(),
        translated_name: String(item.translated_name ?? "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, MAX_NAME_LENGTH),
      }))
      .filter(
        (item) => requestedIds.has(item.id) && item.translated_name.length > 0,
      );
    return NextResponse.json({ translations });
  } catch {
    return errorResponse("장소명을 번역하지 못했습니다.", 502);
  }
}
