import type { VisionCandidateDebug, VisionImageDebugStage } from "@/lib/appraisal/types";

const VISION_ANNOTATE_URL = "https://vision.googleapis.com/v1/images:annotate";
const MAX_CANDIDATES_PER_IMAGE = 8;
const MAX_TEXT_SNIPPETS = 8;
const OCR_NOISE_TERMS = new Set([
  "i",
  "ii",
  "iii",
  "iv",
  "v",
  "vi",
  "vii",
  "viii",
  "ix",
  "x",
  "xi",
  "xii",
]);
const LOW_VALUE_VISUAL_LABELS = new Set([
  "close-up",
  "close up",
  "image",
  "photo",
  "photograph",
  "product",
]);

type WebEntity = {
  description?: string;
  score?: number;
};

type WebLabel = {
  label?: string;
};

type WebPage = {
  pageTitle?: string;
  url?: string;
  score?: number;
};

type VisionResponse = {
  responses?: Array<{
    webDetection?: {
      webEntities?: WebEntity[];
      bestGuessLabels?: WebLabel[];
      pagesWithMatchingImages?: WebPage[];
    };
    logoAnnotations?: Array<{
      description?: string;
      score?: number;
    }>;
    textAnnotations?: Array<{
      description?: string;
    }>;
    error?: {
      message?: string;
    };
  }>;
};

export type GoogleVisionCandidate = {
  query: string;
  score: number;
  source: string;
  imageIndex: number;
};

export type GoogleVisionIdentification = {
  candidates: GoogleVisionCandidate[];
  stages: VisionImageDebugStage[];
};

export function isGoogleVisionConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLOUD_VISION_API_KEY);
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeCandidate(value: string): string {
  return normalizeWhitespace(
    value
      .replace(/\s*[|:–—-]\s*(eBay|Mercari|Rakuten|Amazon|Etsy|WorthPoint).*$/i, "")
      .replace(/\b(for sale|official site|price|prices|buy online|shopping)\b/gi, " ")
      .replace(/[^\p{L}\p{N}\s.'’/-]+/gu, " ")
  );
}

function candidateKey(value: string): string {
  return normalizeCandidate(value).toLowerCase();
}

function isLowValueVisualLabel(value: string): boolean {
  return LOW_VALUE_VISUAL_LABELS.has(value.toLowerCase());
}

function splitOcrText(text: string): string[] {
  return text
    .split(/\n+/)
    .map((line) => normalizeCandidate(line))
    .filter((line) => line.length >= 3 && line.length <= 80)
    .slice(0, MAX_TEXT_SNIPPETS);
}

function isUsefulOcrTerm(value: string): boolean {
  const normalized = value.toLowerCase();

  if (OCR_NOISE_TERMS.has(normalized)) {
    return false;
  }

  if (/^\d+\/\d+$/.test(normalized)) {
    return false;
  }

  if (/^[ivx]+$/i.test(value)) {
    return false;
  }

  if (/^[a-z]?[ivx]+[a-z]?$/i.test(value)) {
    return false;
  }

  return /[a-z]/i.test(value) || /^[a-z]?\d{4,8}[a-z]?$/i.test(value);
}

function buildCompositeOcrQueries(
  imageIndex: number,
  scores: Map<string, GoogleVisionCandidate>,
  logoDescriptions: string[],
  textSnippets: string[],
  bestGuessLabels: string[]
) {
  const usefulText = textSnippets.filter(isUsefulOcrTerm);
  const brandCandidates = [...logoDescriptions, ...usefulText].filter((value) =>
    /^[a-z][a-z .'-]{2,30}$/i.test(value)
  );
  const brand = brandCandidates[0];

  if (!brand || usefulText.length === 0) {
    return;
  }

  const modelTerms = usefulText
    .filter((term) => term.toLowerCase() !== brand.toLowerCase())
    .filter((term) => !/^(precision|automatic|quartz|chronometer)$/i.test(term))
    .slice(0, 4);

  if (modelTerms.length > 0) {
    addCandidate(
      scores,
      imageIndex,
      `${brand} ${modelTerms.slice(0, 3).join(" ")}`,
      165,
      "logo+ocr"
    );
  }

  const bestGuess = bestGuessLabels.find((label) => !/close-up/i.test(label));
  if (bestGuess && !/wall clock|clock face/i.test(bestGuess)) {
    addCandidate(scores, imageIndex, `${brand} ${bestGuess}`, 125, "logo+bestGuessLabel");
  }
}

function addCandidate(
  scores: Map<string, GoogleVisionCandidate>,
  imageIndex: number,
  query: string,
  score: number,
  source: string
) {
  const normalized = normalizeCandidate(query);
  if (
    !normalized ||
    normalized.length < 3 ||
    normalized.length > 120 ||
    isLowValueVisualLabel(normalized)
  ) {
    return;
  }

  const key = candidateKey(normalized);
  const existing = scores.get(key);
  if (!existing || score > existing.score) {
    scores.set(key, {
      query: normalized,
      score,
      source,
      imageIndex,
    });
  }
}

function mergeCandidateScores(candidates: GoogleVisionCandidate[]): GoogleVisionCandidate[] {
  const merged = new Map<string, GoogleVisionCandidate>();

  for (const candidate of candidates) {
    const key = candidateKey(candidate.query);
    const existing = merged.get(key);

    if (!existing) {
      merged.set(key, candidate);
      continue;
    }

    merged.set(key, {
      ...existing,
      score: existing.score + candidate.score * 0.65,
      source: existing.source === candidate.source
        ? existing.source
        : `${existing.source}+${candidate.source}`,
    });
  }

  return [...merged.values()].sort((a, b) => b.score - a.score);
}

async function annotateSingleImage(
  imageBase64: string,
  imageIndex: number
): Promise<{ candidates: GoogleVisionCandidate[]; stage: VisionImageDebugStage }> {
  const apiKey = process.env.GOOGLE_CLOUD_VISION_API_KEY;
  if (!apiKey) {
    throw new Error("GOOGLE_CLOUD_VISION_API_KEY is not set");
  }

  const startedAt = Date.now();
  const response = await fetch(`${VISION_ANNOTATE_URL}?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      requests: [
        {
          image: {
            content: imageBase64,
          },
          features: [
            { type: "WEB_DETECTION", maxResults: 10 },
            { type: "TEXT_DETECTION", maxResults: 5 },
            { type: "LOGO_DETECTION", maxResults: 5 },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Google Vision API failed: ${response.status} ${errorText}`);
  }

  const payload = (await response.json()) as VisionResponse;
  const result = payload.responses?.[0];

  if (result?.error?.message) {
    throw new Error(`Google Vision API failed: ${result.error.message}`);
  }

  const scores = new Map<string, GoogleVisionCandidate>();
  const webDetection = result?.webDetection;
  const bestGuessLabels =
    webDetection?.bestGuessLabels
      ?.map((label) => normalizeCandidate(label.label || ""))
      .filter(Boolean) || [];
  const webEntities =
    webDetection?.webEntities
      ?.map((entity) => ({
        query: normalizeCandidate(entity.description || ""),
        score: Number(entity.score || 0),
        source: "webEntity",
      }))
      .filter((entity) => entity.query) || [];
  const pageTitles =
    webDetection?.pagesWithMatchingImages
      ?.map((page) => normalizeCandidate(page.pageTitle || ""))
      .filter(Boolean) || [];
  const logoDescriptions =
    result?.logoAnnotations
      ?.map((logo) => normalizeCandidate(logo.description || ""))
      .filter(Boolean) || [];
  const textSnippets = splitOcrText(result?.textAnnotations?.[0]?.description || "");
  const hasStrongOcrOrLogo = logoDescriptions.length > 0 || textSnippets.some(isUsefulOcrTerm);

  bestGuessLabels.forEach((label, index) => {
    addCandidate(
      scores,
      imageIndex,
      label,
      (hasStrongOcrOrLogo ? 72 : 100) - index * 8,
      "bestGuessLabel"
    );
  });

  webEntities.forEach((entity, index) => {
    addCandidate(
      scores,
      imageIndex,
      entity.query,
      Math.round(entity.score * 80) + Math.max(0, 25 - index * 3),
      "webEntity"
    );
  });

  logoDescriptions.forEach((logo, index) => {
    addCandidate(scores, imageIndex, logo, 55 - index * 5, "logo");
  });

  textSnippets.forEach((snippet, index) => {
    addCandidate(scores, imageIndex, snippet, 42 - index * 3, "ocr");
  });

  buildCompositeOcrQueries(imageIndex, scores, logoDescriptions, textSnippets, bestGuessLabels);

  pageTitles.slice(0, 6).forEach((title, index) => {
    addCandidate(scores, imageIndex, title, 26 - index * 2, "matchingPageTitle");
  });

  const candidates = [...scores.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_CANDIDATES_PER_IMAGE);
  const debugCandidates: VisionCandidateDebug[] = candidates.map((candidate) => ({
    query: candidate.query,
    score: Number(candidate.score.toFixed(2)),
    source: candidate.source,
  }));

  return {
    candidates,
    stage: {
      imageIndex,
      provider: "google-vision",
      latencyMs: Date.now() - startedAt,
      bestGuessLabels,
      webEntities: webEntities.slice(0, 8).map((entity) => ({
        query: entity.query,
        score: Number(entity.score.toFixed(2)),
        source: entity.source,
      })),
      logoDescriptions,
      textSnippets,
      candidateQueries: debugCandidates,
      errorMessage: null,
    },
  };
}

async function annotateSingleImageSafely(
  imageBase64: string,
  imageIndex: number
): Promise<{ candidates: GoogleVisionCandidate[]; stage: VisionImageDebugStage }> {
  const startedAt = Date.now();

  try {
    return await annotateSingleImage(imageBase64, imageIndex);
  } catch (error) {
    return {
      candidates: [],
      stage: {
        imageIndex,
        provider: "google-vision",
        latencyMs: Date.now() - startedAt,
        bestGuessLabels: [],
        webEntities: [],
        logoDescriptions: [],
        textSnippets: [],
        candidateQueries: [],
        errorMessage:
          error instanceof Error
            ? error.message
            : "Google Vision API で画像解析に失敗しました。",
      },
    };
  }
}

export async function identifyWithGoogleVision(
  images: { data: string }[]
): Promise<GoogleVisionIdentification> {
  const stages = await Promise.all(
    images.map((image, index) => annotateSingleImageSafely(image.data, index))
  );
  const candidates = mergeCandidateScores(stages.flatMap((stage) => stage.candidates));

  return {
    candidates,
    stages: stages.map((stage) => stage.stage),
  };
}
