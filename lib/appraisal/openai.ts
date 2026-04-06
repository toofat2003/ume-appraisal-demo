import { ProductIdentification } from "@/lib/appraisal/types";

const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";

type ImageInput = {
  contentType: string;
  data: string;
};

type OpenAIMessageContent =
  | {
      type: "text";
      text: string;
    }
  | {
      type: "image_url";
      image_url: {
        url: string;
        detail: "low";
      };
    };

function stripCodeFence(value: string): string {
  return value
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

function clampConfidence(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (Number.isNaN(numeric)) {
    return 0.5;
  }
  return Math.max(0, Math.min(1, numeric));
}

export async function identifyProductFromImages(
  images: ImageInput[]
): Promise<ProductIdentification> {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set");
  }

  const model = process.env.OPENAI_APPRAISAL_MODEL || "gpt-4o-mini";

  const messageContent: OpenAIMessageContent[] = [
    {
      type: "text",
      text:
        "Identify the resale item in these photos for an in-home buying service in the United States. " +
        "Use visible labels, logos, form factor, and category cues. " +
        "Return only JSON with these fields: itemName, brand, model, category, categoryGroup, conditionSummary, confidence, searchQuery, reasoning. " +
        "searchQuery must be a concise eBay query. categoryGroup must be one of: luxury, fashion, watch, jewelry, electronics, tools, media, collectible, home, appliance, other. " +
        "confidence must be between 0 and 1. Do not use markdown.",
    },
    ...images.map((image) => ({
      type: "image_url" as const,
      image_url: {
        url: `data:${image.contentType};base64,${image.data}`,
        detail: "low" as const,
      },
    })),
  ];

  const response = await fetch(OPENAI_CHAT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "appraisal_product_identification",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              itemName: { type: "string" },
              brand: { type: "string" },
              model: { type: "string" },
              category: { type: "string" },
              categoryGroup: {
                type: "string",
                enum: [
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
                  "other",
                ],
              },
              conditionSummary: { type: "string" },
              confidence: { type: "number" },
              searchQuery: { type: "string" },
              reasoning: { type: "string" },
            },
            required: [
              "itemName",
              "brand",
              "model",
              "category",
              "categoryGroup",
              "conditionSummary",
              "confidence",
              "searchQuery",
              "reasoning",
            ],
          },
        },
      },
      messages: [
        {
          role: "user",
          content: messageContent,
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI request failed: ${response.status} ${errorText}`);
  }

  const payload = await response.json();
  const raw =
    payload?.choices?.[0]?.message?.content ??
    payload?.choices?.[0]?.message?.refusal;

  if (typeof raw !== "string") {
    throw new Error("OpenAI response did not include JSON content");
  }

  const parsed = JSON.parse(stripCodeFence(raw));

  return {
    itemName: String(parsed.itemName || ""),
    brand: String(parsed.brand || ""),
    model: String(parsed.model || ""),
    category: String(parsed.category || ""),
    categoryGroup: String(parsed.categoryGroup || "other"),
    conditionSummary: String(parsed.conditionSummary || ""),
    confidence: clampConfidence(parsed.confidence),
    searchQuery: String(parsed.searchQuery || parsed.itemName || ""),
    reasoning: String(parsed.reasoning || ""),
  };
}
