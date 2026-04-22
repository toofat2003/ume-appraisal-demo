import type { GeminiIdentificationDebug } from "@/lib/appraisal/types";

const GEMINI_API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_GEMINI_MODEL = "gemini-3-pro-preview";
const MAX_QUERY_CANDIDATES = 8;

type GeminiApiPart = {
  text?: string;
  inlineData?: {
    mimeType: string;
    data: string;
  };
};

type GeminiApiResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
  error?: {
    message?: string;
  };
};

type GeminiJsonCandidate = {
  query?: string;
  score?: number;
  reason?: string;
};

type GeminiJsonResponse = {
  itemName?: string;
  brand?: string;
  model?: string;
  category?: string;
  categoryGroup?: string;
  confidence?: number;
  searchQueries?: GeminiJsonCandidate[];
  evidence?: string[];
  warning?: string | null;
};

export type GeminiQueryCandidate = {
  query: string;
  score: number;
  source: string;
  imageIndex: number;
  reason: string;
};

export type GeminiIdentification = {
  candidates: GeminiQueryCandidate[];
  stage: GeminiIdentificationDebug;
  itemName: string;
  brand: string;
  model: string;
  category: string;
  categoryGroup: string;
  confidence: number;
  warning: string | null;
};

export function isGeminiConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

export function getGeminiModel(): string {
  return process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeQuery(value: string): string {
  return normalizeWhitespace(value.replace(/[^\p{L}\p{N}\s.'’/&+-]+/gu, " "));
}

function clampScore(value: unknown): number {
  const score = Number(value);

  if (!Number.isFinite(score)) {
    return 50;
  }

  if (score <= 1) {
    return Math.max(0, Math.min(100, score * 100));
  }

  return Math.max(0, Math.min(100, score));
}

function normalizeCategoryGroup(value: string | undefined): string {
  const normalized = (value || "").toLowerCase();
  const allowed = new Set([
    "luxury",
    "fashion",
    "watch",
    "jewelry",
    "electronics",
    "tools",
    "media",
    "collectible",
    "home",
    "appliance",
    "coins",
    "other",
  ]);

  return allowed.has(normalized) ? normalized : "fashion";
}

function coerceGeminiJsonResponse(value: unknown): GeminiJsonResponse {
  if (Array.isArray(value)) {
    const firstObject = value.find(
      (item): item is GeminiJsonResponse => Boolean(item) && typeof item === "object"
    );
    return firstObject || {};
  }

  if (value && typeof value === "object") {
    return value as GeminiJsonResponse;
  }

  return {};
}

function extractJson(text: string): GeminiJsonResponse {
  const trimmed = text.trim();

  try {
    return coerceGeminiJsonResponse(JSON.parse(trimmed));
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new Error(`Gemini response was not JSON: ${trimmed.slice(0, 300)}`);
    }
    return coerceGeminiJsonResponse(JSON.parse(match[0]));
  }
}

function buildPrompt(imageCount: number): string {
  return [
    "You are identifying second-hand luxury and fashion items for resale appraisal.",
    "The first image is always the primary product image. Additional images may be a label, price tag, receipt, condition photo, or another angle.",
    "Your goal is product identification only. Do not estimate price. Do not use the visible price as the appraisal value.",
    "If an additional image contains a price tag or label, use only the brand/model/item-name text to improve identification.",
    "Do not let an additional image reduce accuracy. If extra images conflict with the first image, prioritize the primary product in the first image.",
    "Ignore display stands, background shelves, people, mirrors, unrelated bags, and generic visual labels like bag, wool, room, chair, close-up.",
    "Prefer specific search queries that would work on eBay: brand + model/line + product type + distinctive material/color.",
    `There are ${imageCount} input image(s).`,
    "Return strict JSON only with this shape:",
    JSON.stringify({
      itemName: "Specific product name",
      brand: "Brand or empty string",
      model: "Model/line or empty string",
      category: "Specific category",
      categoryGroup: "fashion",
      confidence: 0.0,
      searchQueries: [
        {
          query: "Brand model line product type",
          score: 100,
          reason: "why this is the best query",
        },
      ],
      evidence: ["visible text/logo/visual evidence"],
      warning: null,
    }),
  ].join("\n");
}

function buildParts(images: { data: string; contentType?: string }[]): GeminiApiPart[] {
  return [
    { text: buildPrompt(images.length) },
    ...images.map((image, index) => ({
      text: index === 0 ? "Primary product image:" : `Additional image ${index + 1}:`,
    })),
  ].flatMap((part, index) => {
    if (index === 0) {
      return [part];
    }

    const image = images[index - 1];
    return [
      part,
      {
        inlineData: {
          mimeType: image.contentType || "image/jpeg",
          data: image.data,
        },
      },
    ];
  });
}

function buildFallbackCandidate(parsed: GeminiJsonResponse): GeminiJsonCandidate[] {
  const query = normalizeQuery(
    [parsed.brand, parsed.model, parsed.itemName || parsed.category].filter(Boolean).join(" ")
  );

  return query
    ? [
        {
          query,
          score: 55,
          reason: "fallback query from Gemini item fields",
        },
      ]
    : [];
}

function parseGeminiCandidates(parsed: GeminiJsonResponse): GeminiQueryCandidate[] {
  const rawCandidates =
    parsed.searchQueries && parsed.searchQueries.length > 0
      ? parsed.searchQueries
      : buildFallbackCandidate(parsed);
  const deduped = new Map<string, GeminiQueryCandidate>();

  for (const candidate of rawCandidates) {
    const query = normalizeQuery(candidate.query || "");
    if (!query || query.length < 3 || query.length > 160) {
      continue;
    }

    const key = query.toLowerCase();
    const score = clampScore(candidate.score);
    const existing = deduped.get(key);
    if (existing && existing.score >= score) {
      continue;
    }

    deduped.set(key, {
      query,
      score,
      source: "gemini",
      imageIndex: 0,
      reason: candidate.reason || "Gemini-generated query",
    });
  }

  return [...deduped.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_QUERY_CANDIDATES);
}

export async function identifyWithGemini(
  images: { data: string; contentType?: string }[]
): Promise<GeminiIdentification> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not set");
  }

  const model = getGeminiModel();
  const startedAt = Date.now();
  const response = await fetch(
    `${GEMINI_API_BASE_URL}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: buildParts(images),
          },
        ],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: "application/json",
        },
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API failed: ${response.status} ${errorText}`);
  }

  const payload = (await response.json()) as GeminiApiResponse;
  if (payload.error?.message) {
    throw new Error(`Gemini API failed: ${payload.error.message}`);
  }

  const responseText =
    payload.candidates?.[0]?.content?.parts
      ?.map((part) => part.text || "")
      .join("\n")
      .trim() || "";
  const parsed = extractJson(responseText);
  const candidates = parseGeminiCandidates(parsed);
  const itemName = normalizeWhitespace(parsed.itemName || candidates[0]?.query || "Gemini item");
  const brand = normalizeWhitespace(parsed.brand || "");
  const modelName = normalizeWhitespace(parsed.model || "");
  const category = normalizeWhitespace(parsed.category || "fashion item");
  const confidence = clampScore(parsed.confidence) / 100;
  const evidence = Array.isArray(parsed.evidence)
    ? parsed.evidence.map((item) => normalizeWhitespace(String(item))).filter(Boolean).slice(0, 8)
    : [];

  return {
    candidates,
    itemName,
    brand,
    model: modelName,
    category,
    categoryGroup: normalizeCategoryGroup(parsed.categoryGroup),
    confidence,
    warning: parsed.warning || null,
    stage: {
      provider: "gemini",
      model,
      latencyMs: Date.now() - startedAt,
      itemName,
      brand,
      modelName,
      category,
      confidence: Number(confidence.toFixed(2)),
      usedImageCount: images.length,
      queryCandidates: candidates.map((candidate) => ({
        query: candidate.query,
        score: Number(candidate.score.toFixed(1)),
        reason: candidate.reason,
      })),
      evidence,
      warning: parsed.warning || null,
      errorMessage: null,
    },
  };
}
