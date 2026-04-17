import { PricingSummary, ProductIdentification } from "@/lib/appraisal/types";

export const DEFAULT_HISTORY_LIMIT = 12;

export type HistoryImageInput = {
  file: File;
  slotLabel: string;
};

export type SaveAppraisalHistoryInput = {
  identification: ProductIdentification;
  pricing: PricingSummary;
  images: HistoryImageInput[];
  rawResult?: unknown;
};

export function sanitizeSegment(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "file";
}

export function getExtension(file: File): string {
  const nameParts = file.name.split(".");
  const fileExtension =
    nameParts.length > 1 ? sanitizeSegment(nameParts.at(-1) || "") : "";

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

export function mapPricing(pricing: PricingSummary) {
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
