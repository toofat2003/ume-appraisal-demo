import { list, put } from "@vercel/blob";
import {
  AppraisalHistoryImage,
  AppraisalHistoryItem,
  PricingSummary,
  ProductIdentification,
} from "@/lib/appraisal/types";

const DEFAULT_HISTORY_LIMIT = 12;

type HistoryImageInput = {
  file: File;
  slotLabel: string;
};

type SaveAppraisalHistoryInput = {
  identification: ProductIdentification;
  pricing: PricingSummary;
  images: HistoryImageInput[];
};

function isBlobConfigured(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

function getHistoryNamespace(): string {
  if (process.env.NODE_ENV !== "production") {
    return "local";
  }

  return process.env.VERCEL_ENV || "production";
}

function getHistoryRecordPrefix(): string {
  return `${getHistoryNamespace()}/history-records/`;
}

function getHistoryImagePrefix(): string {
  return `${getHistoryNamespace()}/history-images/`;
}

function sanitizeSegment(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "file";
}

function getExtension(file: File): string {
  const nameParts = file.name.split(".");
  const fileExtension = nameParts.length > 1 ? sanitizeSegment(nameParts.at(-1) || "") : "";

  if (fileExtension) {
    return fileExtension;
  }

  switch (file.type) {
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/heic":
      return "heic";
    case "image/heif":
      return "heif";
    default:
      return "jpg";
  }
}

function mapPricing(pricing: PricingSummary) {
  return {
    suggestedMaxPrice: pricing.suggestedMaxPrice,
    buyPriceRangeLow: pricing.buyPriceRangeLow,
    buyPriceRangeHigh: pricing.buyPriceRangeHigh,
    low: pricing.low,
    median: pricing.median,
    high: pricing.high,
    listingCount: pricing.listingCount,
  };
}

function isAppraisalHistoryItem(value: unknown): value is AppraisalHistoryItem {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.createdAt === "string" &&
    Array.isArray(candidate.images) &&
    typeof candidate.identification === "object" &&
    candidate.identification !== null &&
    typeof candidate.pricing === "object" &&
    candidate.pricing !== null
  );
}

async function fetchHistoryRecord(url: string): Promise<AppraisalHistoryItem | null> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as unknown;
  return isAppraisalHistoryItem(payload) ? payload : null;
}

export async function saveAppraisalHistory(
  input: SaveAppraisalHistoryInput
): Promise<AppraisalHistoryItem | null> {
  if (!isBlobConfigured() || input.images.length === 0) {
    return null;
  }

  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  const images: AppraisalHistoryImage[] = await Promise.all(
    input.images.map(async ({ file, slotLabel }, index) => {
      const pathname = `${getHistoryImagePrefix()}${id}/${String(index + 1).padStart(2, "0")}-${sanitizeSegment(
        slotLabel
      )}.${getExtension(file)}`;
      const blob = await put(pathname, file, {
        access: "public",
        addRandomSuffix: false,
        contentType: file.type || undefined,
      });

      return {
        url: blob.url,
        pathname: blob.pathname,
        slotLabel,
      };
    })
  );

  const item: AppraisalHistoryItem = {
    id,
    createdAt,
    images,
    identification: input.identification,
    pricing: mapPricing(input.pricing),
  };

  const recordPathname = `${getHistoryRecordPrefix()}${createdAt.replace(/[:.]/g, "-")}_${id}.json`;
  await put(recordPathname, JSON.stringify(item, null, 2), {
    access: "public",
    addRandomSuffix: false,
    contentType: "application/json; charset=utf-8",
    cacheControlMaxAge: 60,
  });

  return item;
}

export async function listAppraisalHistory(
  limit = DEFAULT_HISTORY_LIMIT
): Promise<AppraisalHistoryItem[]> {
  if (!isBlobConfigured()) {
    return [];
  }

  const page = await list({
    prefix: getHistoryRecordPrefix(),
    limit: Math.max(limit * 3, limit),
  });

  const recordBlobs = [...page.blobs]
    .sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime())
    .slice(0, limit);

  const items = await Promise.all(recordBlobs.map((blob) => fetchHistoryRecord(blob.url)));

  return items
    .filter((item): item is AppraisalHistoryItem => item !== null)
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
}

export function isHistoryStorageEnabled(): boolean {
  return isBlobConfigured();
}
