import {
  AppraisalDebug,
  ImageSearchDebugStage,
  ListingSummary,
  PricePoint,
  ProductIdentification,
  QuerySearchDebugStage,
} from "@/lib/appraisal/types";
import {
  identifyWithGoogleVision,
  isGoogleVisionConfigured,
} from "@/lib/appraisal/googleVision";
import {
  identifyWithGemini,
  isGeminiConfigured,
  type GeminiIdentification,
} from "@/lib/appraisal/gemini";

const DEFAULT_MARKETPLACE_ID = "EBAY_US";
const OAUTH_SCOPE = "https://api.ebay.com/oauth/api_scope";

type EbayEnvironment = "production" | "sandbox";
type ImageIdentificationProvider = "auto" | "gemini" | "google-vision" | "ebay-image";

type QueryCandidate = {
  query: string;
  score: number;
  source: string;
  imageIndex: number;
};

type GeminiAttemptMode = "primary-only" | "all-images";

type SearchListingsResult = {
  identification: ProductIdentification;
  listings: ListingSummary[];
  accessoryFilteredCount: number;
  debug: AppraisalDebug;
};

type TokenCache = {
  accessToken: string;
  expiresAt: number;
};

const WATCH_ITEM_KEYWORDS = [
  "watch",
  "wristwatch",
  "submariner",
  "datejust",
  "daytona",
  "gmt-master",
  "gmt master",
  "explorer",
  "yacht-master",
  "yacht master",
  "sea-dweller",
  "sea dweller",
  "milgauss",
  "speedmaster",
  "seamaster",
  "navitimer",
  "carrera",
  "aquaracer",
  "santos",
  "tank",
  "royal oak",
  "nautilus",
  "black bay",
  "day-date",
  "day date",
  "oyster perpetual",
  "air-king",
  "air king",
];

const WATCH_ACCESSORY_KEYWORDS = [
  "band",
  "watch band",
  "watchband",
  "bracelet",
  "strap",
  "links",
  "link",
  "clasp",
  "buckle",
  "endlink",
  "endlinks",
  "spring bar",
  "spring bars",
  "replacement",
  "repair",
  "parts",
  "part",
  "dial",
  "hands",
  "movement",
  "bezel",
  "insert",
  "crystal",
  "case only",
  "head only",
  "watch only no band",
  "without band",
  "warranty card",
  "card only",
  "box only",
  "papers only",
];

const WATCH_CATEGORY_KEYWORDS = [
  "wristwatch",
  "wristwatches",
  "pocket watch",
  "pocket watches",
  "watch accessories",
  "wristwatch bands",
];

const JEWELRY_CATEGORY_KEYWORDS = [
  "ring",
  "rings",
  "necklace",
  "necklaces",
  "pendant",
  "pendants",
  "bracelets & charms",
  "bracelet",
  "bracelets",
  "charms",
  "earring",
  "earrings",
  "brooch",
  "brooches",
  "jewelry",
  "jewellery",
];

const COIN_CATEGORY_KEYWORDS = [
  "coin",
  "coins",
  "currency",
  "banknote",
  "banknotes",
  "note",
  "notes",
  "paper money",
  "numis",
  "roman",
  "dollar",
  "dime",
  "nickel",
  "cent",
  "quarter",
  "mint",
  "medal",
  "token",
  "historical currency",
  "confederate currency",
  "silver certificate",
  "obsolete banknote",
];

const FASHION_CATEGORY_KEYWORDS = ["bag", "handbag", "wallet", "fashion"];

const APPAREL_CATEGORY_KEYWORDS = [
  "tops",
  "shirts",
  "t-shirts",
  "t shirt",
  "t-shirts",
  "coats",
  "jackets",
  "vests",
  "hoodies",
  "sweaters",
  "sweatshirts",
  "pants",
  "trousers",
  "dress",
  "dresses",
  "skirts",
  "outerwear",
  "mens clothing",
  "women's clothing",
];

const ANTIQUE_CATEGORY_KEYWORDS = [
  "collect",
  "antique",
  "art",
  "vase",
  "pottery",
  "figurine",
  "painting",
  "print",
  "sculpture",
];

const TITLE_STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "automatic",
  "authentic",
  "auth",
  "black",
  "blue",
  "box",
  "card",
  "date",
  "dial",
  "for",
  "from",
  "full",
  "genuine",
  "gold",
  "good",
  "gray",
  "green",
  "in",
  "japan",
  "large",
  "ladies",
  "leather",
  "lot",
  "mens",
  "men",
  "new",
  "no",
  "of",
  "on",
  "oyster",
  "papers",
  "pre",
  "owned",
  "precision",
  "quartz",
  "roman",
  "set",
  "silver",
  "small",
  "stainless",
  "solid",
  "steel",
  "the",
  "unworn",
  "used",
  "vintage",
  "watch",
  "white",
  "with",
  "wristwatch",
  "w",
]);

const MAX_GOOGLE_VISION_QUERY_CANDIDATES = 5;
const GEMINI_ALL_IMAGES_SELECTION_MARGIN = 8;

let tokenCache: TokenCache | null = null;
let tokenPromise: Promise<string> | null = null;

function getEnvironment(): EbayEnvironment {
  return process.env.EBAY_ENV === "sandbox" ? "sandbox" : "production";
}

function getBaseUrl(env: EbayEnvironment): string {
  return env === "sandbox" ? "https://api.sandbox.ebay.com" : "https://api.ebay.com";
}

function getMarketplaceId(): string {
  return process.env.EBAY_MARKETPLACE_ID || DEFAULT_MARKETPLACE_ID;
}

function getImageIdentificationProvider(): ImageIdentificationProvider {
  const value = (process.env.APPRAISAL_IMAGE_PROVIDER || "auto").toLowerCase();

  if (value === "gemini" || value === "google-vision" || value === "ebay-image" || value === "auto") {
    return value;
  }

  return "auto";
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeTitle(value: string): string {
  return normalizeWhitespace(value).toLowerCase();
}

function normalizeCompact(value: string): string {
  return normalizeTitle(value).replace(/[^a-z0-9]+/g, "");
}

function titleTokens(value: string): string[] {
  return normalizeTitle(value)
    .replace(/[^a-z0-9-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function containsAny(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword));
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsTerm(text: string, term: string): boolean {
  const pattern = new RegExp(
    `(^|[^a-z0-9])${escapeRegex(term).replace(/\s+/g, "\\s+")}($|[^a-z0-9])`
  );
  return pattern.test(text);
}

function containsAnyTerm(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => containsTerm(text, keyword));
}

function isWatchAccessoryCategoryPath(categoryPath: string[]): boolean {
  const normalized = normalizeTitle(categoryPath.join(" "));
  return normalized.includes("watch accessories") || normalized.includes("wristwatch bands");
}

function createBasicAuth(clientId: string, clientSecret: string): string {
  return Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
}

async function getAccessToken(): Promise<string> {
  const clientId = process.env.EBAY_CLIENT_ID;
  const clientSecret = process.env.EBAY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("EBAY_CLIENT_ID or EBAY_CLIENT_SECRET is not set");
  }

  if (tokenCache && Date.now() < tokenCache.expiresAt) {
    return tokenCache.accessToken;
  }

  if (tokenPromise) {
    return tokenPromise;
  }

  tokenPromise = (async () => {
    const env = getEnvironment();
    const response = await fetch(`${getBaseUrl(env)}/identity/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${createBasicAuth(clientId, clientSecret)}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        scope: OAUTH_SCOPE,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`eBay OAuth failed: ${response.status} ${errorText}`);
    }

    const payload = await response.json();
    tokenCache = {
      accessToken: payload.access_token,
      expiresAt: Date.now() + Math.max(60, Number(payload.expires_in || 7200) - 120) * 1000,
    };

    return tokenCache.accessToken;
  })();

  try {
    return await tokenPromise;
  } finally {
    tokenPromise = null;
  }
}

function parseMoney(amount: unknown, currency: unknown): PricePoint {
  return {
    amount: Number(amount || 0),
    currency: typeof currency === "string" ? currency : "USD",
  };
}

function getShipping(item: Record<string, unknown>): PricePoint | null {
  const shippingOptions = Array.isArray(item.shippingOptions)
    ? (item.shippingOptions as Record<string, unknown>[])
    : [];

  for (const option of shippingOptions) {
    const shippingCost = option.shippingCost as Record<string, unknown> | undefined;
    if (!shippingCost) {
      continue;
    }
    return parseMoney(shippingCost.value, shippingCost.currency);
  }

  return null;
}

function getConditionBucket(condition: string): "used" | "other" {
  const normalized = condition.toLowerCase();
  if (
    normalized.includes("used") ||
    normalized.includes("pre-owned") ||
    normalized.includes("seller refurbished") ||
    normalized.includes("certified refurbished") ||
    normalized.includes("very good") ||
    normalized.includes("good")
  ) {
    return "used";
  }
  return "other";
}

function listingFromItem(item: Record<string, unknown>): ListingSummary | null {
  const price = parseMoney(
    (item.price as Record<string, unknown> | undefined)?.value,
    (item.price as Record<string, unknown> | undefined)?.currency
  );

  if (!price.amount) {
    return null;
  }

  const shipping = getShipping(item);
  const totalPrice = {
    amount: price.amount + (shipping?.amount || 0),
    currency: price.currency,
  };

  const title = typeof item.title === "string" ? normalizeWhitespace(item.title) : "";
  const itemWebUrl = typeof item.itemWebUrl === "string" ? item.itemWebUrl : "";

  if (!title || !itemWebUrl) {
    return null;
  }

  return {
    id: typeof item.itemId === "string" ? item.itemId : title,
    title,
    condition: typeof item.condition === "string" ? item.condition : "Unknown",
    itemWebUrl,
    imageUrl:
      typeof (item.image as Record<string, unknown> | undefined)?.imageUrl === "string"
        ? ((item.image as Record<string, unknown>).imageUrl as string)
        : null,
    leafCategoryIds: Array.isArray(item.leafCategoryIds)
      ? item.leafCategoryIds.filter((value): value is string => typeof value === "string")
      : [],
    categoryPath: Array.isArray(item.categories)
      ? (item.categories as Record<string, unknown>[])
          .map((category) =>
            typeof category.categoryName === "string" ? category.categoryName : null
          )
          .filter((value): value is string => value !== null)
      : [],
    price,
    shipping,
    totalPrice,
    seller: typeof (item.seller as Record<string, unknown> | undefined)?.username === "string"
      ? ((item.seller as Record<string, unknown>).username as string)
      : "Unknown seller",
    location: typeof item.itemLocation === "string"
      ? (item.itemLocation as string)
      : typeof (item.itemLocation as Record<string, unknown> | undefined)?.country === "string"
        ? ((item.itemLocation as Record<string, unknown>).country as string)
        : "US",
  };
}

function toDisplayToken(token: string): string {
  if (/^\d+$/.test(token)) {
    return token;
  }
  return token
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("-");
}

function inferBrand(listings: ListingSummary[]): string {
  const scores = new Map<string, number>();

  listings.slice(0, 10).forEach((listing, index) => {
    const weight = Math.max(1, 10 - index);
    const token = titleTokens(listing.title)[0];
    if (!token || TITLE_STOPWORDS.has(token) || /^\d+$/.test(token)) {
      return;
    }
    scores.set(token, (scores.get(token) || 0) + weight);
  });

  let bestToken = "";
  let bestScore = 0;
  for (const [token, score] of scores.entries()) {
    if (score > bestScore) {
      bestToken = token;
      bestScore = score;
    }
  }

  return bestToken ? toDisplayToken(bestToken) : "";
}

function inferModel(listings: ListingSummary[], brand: string): string {
  const unigramScores = new Map<string, number>();
  const bigramScores = new Map<string, number>();
  const brandToken = brand.toLowerCase();

  listings.slice(0, 10).forEach((listing, index) => {
    const weight = Math.max(1, 10 - index);
    const tokens = titleTokens(listing.title).filter((token) => token !== brandToken);
    const informative = tokens.filter(
      (token) =>
        !TITLE_STOPWORDS.has(token) &&
        token.length >= 2 &&
        !["good", "excellent", "very", "random", "number", "second", "hand"].includes(token)
    );

    informative.forEach((token) => {
      unigramScores.set(token, (unigramScores.get(token) || 0) + weight);
    });

    for (let i = 0; i < informative.length - 1; i += 1) {
      const bigram = `${informative[i]} ${informative[i + 1]}`;
      bigramScores.set(bigram, (bigramScores.get(bigram) || 0) + weight);
    }
  });

  let bestBigram = "";
  let bestBigramScore = 0;
  for (const [bigram, score] of bigramScores.entries()) {
    if (score > bestBigramScore) {
      bestBigram = bigram;
      bestBigramScore = score;
    }
  }

  if (bestBigramScore >= 8) {
    return bestBigram
      .split(" ")
      .map((token) => toDisplayToken(token))
      .join(" ");
  }

  let bestToken = "";
  let bestScore = 0;
  for (const [token, score] of unigramScores.entries()) {
    if (score > bestScore) {
      bestToken = token;
      bestScore = score;
    }
  }

  return bestToken ? toDisplayToken(bestToken) : "";
}

function inferReferenceToken(listings: ListingSummary[], brand: string, model: string): string {
  const scores = new Map<string, number>();
  const excluded = new Set(
    [brand, model]
      .flatMap((value) => titleTokens(value))
      .filter(Boolean)
  );

  listings.slice(0, 10).forEach((listing, index) => {
    const weight = Math.max(1, 10 - index);
    const tokens = titleTokens(listing.title);

    tokens.forEach((token) => {
      if (excluded.has(token)) {
        return;
      }

      if (/^[a-z]?\d{4,6}[a-z]?$/.test(token) || /^\d{2,4}mm$/.test(token)) {
        scores.set(token, (scores.get(token) || 0) + weight);
      }
    });
  });

  let bestToken = "";
  let bestScore = 0;

  for (const [token, score] of scores.entries()) {
    if (score > bestScore) {
      bestToken = token;
      bestScore = score;
    }
  }

  return bestScore >= 8 ? toDisplayToken(bestToken) : "";
}

function buildSearchQueryFromListings(listings: ListingSummary[]): string {
  const brand = inferBrand(listings);
  const model = inferModel(listings, brand);
  const referenceToken = inferReferenceToken(listings, brand, model);
  const queryParts = [brand, model, referenceToken].filter(Boolean);

  if (queryParts.length > 0) {
    return normalizeWhitespace(queryParts.join(" "));
  }

  return listings[0]?.title || "";
}

function inferCategory(listings: ListingSummary[]): string {
  const scores = new Map<string, number>();

  listings.slice(0, 10).forEach((listing, index) => {
    const weight = Math.max(1, 10 - index);
    const category = listing.categoryPath[0];
    if (!category) {
      return;
    }
    scores.set(category, (scores.get(category) || 0) + weight);
  });

  let bestCategory = "";
  let bestScore = 0;
  for (const [category, score] of scores.entries()) {
    if (score > bestScore) {
      bestCategory = category;
      bestScore = score;
    }
  }

  return bestCategory || "eBay画像検索";
}

function inferCategoryGroup(category: string, listings: ListingSummary[]): string {
  const categoryText = normalizeTitle(
    [category, ...listings.slice(0, 5).flatMap((listing) => listing.categoryPath)].join(" ")
  );
  const titleText = normalizeTitle(listings.slice(0, 5).map((listing) => listing.title).join(" "));
  const combinedText = normalizeWhitespace(`${categoryText} ${titleText}`);

  if (containsAnyTerm(categoryText, WATCH_CATEGORY_KEYWORDS) || inferWatchSearch(listings)) {
    return "watch";
  }
  if (containsAnyTerm(categoryText, JEWELRY_CATEGORY_KEYWORDS)) {
    return "jewelry";
  }
  if (
    containsAnyTerm(categoryText, FASHION_CATEGORY_KEYWORDS) ||
    containsAnyTerm(categoryText, APPAREL_CATEGORY_KEYWORDS)
  ) {
    return "fashion";
  }
  if (
    combinedText.includes("phone") ||
    combinedText.includes("laptop") ||
    combinedText.includes("electronics")
  ) {
    return "electronics";
  }
  if (combinedText.includes("tool")) {
    return "tools";
  }
  if (containsAnyTerm(combinedText, COIN_CATEGORY_KEYWORDS)) {
    return "coins";
  }
  if (containsAnyTerm(categoryText, ANTIQUE_CATEGORY_KEYWORDS)) {
    return "collectible";
  }
  if (combinedText.includes("appliance")) {
    return "appliance";
  }
  if (combinedText.includes("home")) {
    return "home";
  }
  return "other";
}

function inferWatchSearch(listings: ListingSummary[]): boolean {
  const sample = listings.slice(0, 6);
  const watchHits = sample.filter((listing) =>
    containsAny(normalizeTitle(listing.title), WATCH_ITEM_KEYWORDS)
  ).length;

  return watchHits >= 1;
}

type CategorySelection = {
  selectedCategoryId: string | null;
  listings: ListingSummary[];
  isReliable: boolean;
  scoreShare: number;
};

function selectDominantCategoryForImage(listings: ListingSummary[]): CategorySelection {
  if (listings.length === 0) {
    return { selectedCategoryId: null, listings: [], isReliable: false, scoreShare: 0 };
  }

  const categoryScores = new Map<
    string,
    { score: number; listings: ListingSummary[]; isAccessoryCategory: boolean }
  >();

  listings.slice(0, 12).forEach((listing, index) => {
    const weight = Math.max(1, 12 - index);
    const leafCategoryId = listing.leafCategoryIds[0] || "unknown";
    const current = categoryScores.get(leafCategoryId) || {
      score: 0,
      listings: [],
      isAccessoryCategory: isWatchAccessoryCategoryPath(listing.categoryPath),
    };
    current.score += weight;
    current.listings.push(listing);
    current.isAccessoryCategory =
      current.isAccessoryCategory || isWatchAccessoryCategoryPath(listing.categoryPath);
    categoryScores.set(leafCategoryId, current);
  });

  const entries = [...categoryScores.entries()];
  if (entries.length === 0) {
    return { selectedCategoryId: null, listings: [], isReliable: false, scoreShare: 0 };
  }

  const nonAccessoryEntries = entries.filter(([, entry]) => !entry.isAccessoryCategory);
  const candidates = nonAccessoryEntries.length > 0 ? nonAccessoryEntries : entries;
  const totalScore = candidates.reduce((sum, [, entry]) => sum + entry.score, 0);

  let best: [string, { score: number; listings: ListingSummary[]; isAccessoryCategory: boolean }] | null =
    null;
  for (const entry of candidates) {
    if (!best || entry[1].score > best[1].score) {
      best = entry;
    }
  }

  if (!best) {
    return { selectedCategoryId: null, listings: [], isReliable: false, scoreShare: 0 };
  }

  const scoreShare = totalScore > 0 ? best[1].score / totalScore : 0;
  const isReliable = scoreShare >= 0.45 || best[1].listings.length >= 3;

  return {
    selectedCategoryId: best[0],
    listings: best[1].listings,
    isReliable,
    scoreShare,
  };
}

function isWatchAccessoryOnly(listing: ListingSummary): boolean {
  const normalizedTitle = normalizeTitle(listing.title);
  const compactTitle = normalizeCompact(listing.title);
  const categoryPath = normalizeTitle(listing.categoryPath.join(" "));
  const hasAccessoryCategory =
    categoryPath.includes("watch accessories") ||
    categoryPath.includes("wristwatch bands");
  const hasAccessoryKeyword =
    containsAny(normalizedTitle, WATCH_ACCESSORY_KEYWORDS) ||
    containsAny(compactTitle, [
      "watchband",
      "warrantycard",
      "cardonly",
      "boxonly",
      "papersonly",
      "headonly",
      "caseonly",
    ]);
  const hasMainWatchKeyword = containsAny(normalizedTitle, WATCH_ITEM_KEYWORDS);

  if (hasAccessoryCategory) {
    return true;
  }

  if (!hasAccessoryKeyword) {
    return false;
  }

  if (
    normalizedTitle.includes("warranty card") ||
    compactTitle.includes("warrantycard") ||
    normalizedTitle.includes("card only") ||
    compactTitle.includes("cardonly") ||
    normalizedTitle.includes("box only") ||
    compactTitle.includes("boxonly") ||
    normalizedTitle.includes("papers only") ||
    compactTitle.includes("papersonly") ||
    normalizedTitle.includes("case only") ||
    compactTitle.includes("caseonly") ||
    normalizedTitle.includes("head only") ||
    compactTitle.includes("headonly") ||
    normalizedTitle.includes("watch band") ||
    compactTitle.includes("watchband") ||
    normalizedTitle.includes("watch strap")
  ) {
    return true;
  }

  return !hasMainWatchKeyword;
}

function filterAccessoryOnlyListings(listings: ListingSummary[]): {
  listings: ListingSummary[];
  accessoryFilteredCount: number;
} {
  if (!inferWatchSearch(listings)) {
    return { listings, accessoryFilteredCount: 0 };
  }

  const filtered = listings.filter((listing) => !isWatchAccessoryOnly(listing));

  if (filtered.length === 0) {
    return { listings, accessoryFilteredCount: 0 };
  }

  return {
    listings: filtered,
    accessoryFilteredCount: listings.length - filtered.length,
  };
}

type ImageStageEvaluation = {
  imageIndex: number;
  latencyMs: number;
  rawListings: ListingSummary[];
  usedListings: ListingSummary[];
  selectedListings: ListingSummary[];
  accessoryFilteredCount: number;
  selectedCategoryId: string | null;
  categoryScoreShare: number;
  isReliable: boolean;
  score: number;
  errorMessage?: string | null;
};

function scoreImageStage(stage: {
  listings: ListingSummary[];
  isReliable: boolean;
  categoryScoreShare: number;
  accessoryFilteredCount: number;
}): number {
  if (stage.listings.length === 0) {
    return 0;
  }

  const listingScore = Math.min(stage.listings.length, 8) * 10;
  const reliabilityScore = stage.isReliable ? 25 : 0;
  const categoryScore = Math.round(stage.categoryScoreShare * 60);
  const accessoryPenalty = stage.accessoryFilteredCount * 6;

  return Math.max(0, listingScore + reliabilityScore + categoryScore - accessoryPenalty);
}

function toImageDebugStage(stage: ImageStageEvaluation): ImageSearchDebugStage {
  return {
    imageIndex: stage.imageIndex,
    latencyMs: stage.latencyMs,
    rawListingCount: stage.rawListings.length,
    usedListingCount: stage.usedListings.length,
    selectedListingCount: stage.selectedListings.length,
    accessoryFilteredCount: stage.accessoryFilteredCount,
    selectedCategoryId: stage.selectedCategoryId,
    categoryScoreShare: Number(stage.categoryScoreShare.toFixed(2)),
    isReliable: stage.isReliable,
    score: stage.score,
    topTitles: stage.selectedListings.slice(0, 5).map((listing) => listing.title),
    errorMessage: stage.errorMessage ?? null,
  };
}

function formatImageSearchError(error: unknown): string {
  const message =
    error instanceof Error ? error.message : "画像検索で予期しないエラーが発生しました。";

  if (message.includes("The string did not match the expected pattern")) {
    return "画像形式の解釈に失敗しました。別の写真に差し替えるか、JPEG/PNG で再撮影してください。";
  }

  if (message.includes("eBay searchByImage failed")) {
    return "eBay の画像検索に失敗したため、この写真は参照から除外しました。";
  }

  return message;
}

function pickBestImageStage(stages: ImageStageEvaluation[]): ImageStageEvaluation | null {
  const ranked = stages
    .filter((stage) => stage.selectedListings.length > 0)
    .sort((left, right) => right.score - left.score);

  return ranked[0] || null;
}

function filterTextSearchListings(
  listings: ListingSummary[],
  selectedCategoryId: string | null
): { listings: ListingSummary[]; accessoryFilteredCount: number; dominantCategoryId: string | null } {
  const usedListings = listings.filter((listing) => getConditionBucket(listing.condition) === "used");
  const categoryFiltered =
    selectedCategoryId !== null
      ? usedListings.filter((listing) => listing.leafCategoryIds.includes(selectedCategoryId))
      : usedListings;
  const dominantCategoryFiltered = filterToDominantCategory(
    categoryFiltered.length > 0 ? categoryFiltered : usedListings
  );
  const accessoryFiltered = filterAccessoryOnlyListings(dominantCategoryFiltered.listings);

  return {
    listings:
      accessoryFiltered.listings.length > 0
        ? accessoryFiltered.listings
        : dominantCategoryFiltered.listings,
    accessoryFilteredCount: accessoryFiltered.accessoryFilteredCount,
    dominantCategoryId: dominantCategoryFiltered.dominantCategoryId,
  };
}

async function searchRaw(query: string): Promise<ListingSummary[]> {
  const token = await getAccessToken();
  const env = getEnvironment();
  const url = new URL(`${getBaseUrl(env)}/buy/browse/v1/item_summary/search`);
  url.searchParams.set("q", query);
  url.searchParams.set("limit", "24");
  url.searchParams.set("filter", "conditions:{USED},buyingOptions:{FIXED_PRICE}");

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
      "X-EBAY-C-MARKETPLACE-ID": getMarketplaceId(),
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`eBay Browse search failed: ${response.status} ${errorText}`);
  }

  const payload = await response.json();
  const items = Array.isArray(payload.itemSummaries) ? payload.itemSummaries : [];

  return items
    .map((item: unknown) => listingFromItem(item as Record<string, unknown>))
    .filter((item: ListingSummary | null): item is ListingSummary => item !== null);
}

function scoreFromListings(listings: ListingSummary[]): number {
  if (listings.length >= 12) {
    return 0.9;
  }
  if (listings.length >= 6) {
    return 0.75;
  }
  if (listings.length >= 3) {
    return 0.6;
  }
  return 0.45;
}

function dedupeListings(listings: ListingSummary[]): ListingSummary[] {
  const seen = new Set<string>();
  const deduped: ListingSummary[] = [];

  for (const listing of listings) {
    if (seen.has(listing.id)) {
      continue;
    }
    seen.add(listing.id);
    deduped.push(listing);
  }

  return deduped;
}

function getDominantLeafCategoryId(listings: ListingSummary[]): string | null {
  const scores = new Map<string, number>();

  listings.slice(0, 12).forEach((listing, index) => {
    const weight = Math.max(1, 12 - index);
    for (const leafCategoryId of listing.leafCategoryIds) {
      scores.set(leafCategoryId, (scores.get(leafCategoryId) || 0) + weight);
    }
  });

  let dominantCategoryId: string | null = null;
  let bestScore = -1;

  for (const [categoryId, score] of scores.entries()) {
    if (score > bestScore) {
      dominantCategoryId = categoryId;
      bestScore = score;
    }
  }

  return dominantCategoryId;
}

function filterToDominantCategory(listings: ListingSummary[]): {
  listings: ListingSummary[];
  dominantCategoryId: string | null;
} {
  const dominantCategoryId = getDominantLeafCategoryId(listings);

  if (!dominantCategoryId) {
    return { listings, dominantCategoryId: null };
  }

  const filtered = listings.filter((listing) =>
    listing.leafCategoryIds.includes(dominantCategoryId)
  );

  return {
    listings: filtered.length > 0 ? filtered : listings,
    dominantCategoryId,
  };
}

async function searchListingsForSingleImage(
  imageBase64: string,
  imageIndex: number
): Promise<ImageStageEvaluation> {
  const startedAt = Date.now();
  const initial = await searchByImageRaw(imageBase64);
  const usedListings = initial.listings.filter((listing) => getConditionBucket(listing.condition) === "used");
  const dominantCategoryId = initial.dominantCategoryId;
  const narrowedByCategory =
    dominantCategoryId === null
      ? usedListings
      : usedListings.filter((listing) => listing.leafCategoryIds.includes(dominantCategoryId));
  const selected = selectDominantCategoryForImage(
    narrowedByCategory.length > 0 ? narrowedByCategory : usedListings
  );
  const accessoryFiltered = filterAccessoryOnlyListings(selected.listings);
  const selectedListings =
    accessoryFiltered.listings.length > 0 ? accessoryFiltered.listings : selected.listings;
  const score = scoreImageStage({
    listings: selectedListings,
    isReliable: selected.isReliable,
    categoryScoreShare: selected.scoreShare,
    accessoryFilteredCount: accessoryFiltered.accessoryFilteredCount,
  });

  return {
    imageIndex,
    latencyMs: Date.now() - startedAt,
    rawListings: initial.listings,
    usedListings,
    selectedListings,
    accessoryFilteredCount: accessoryFiltered.accessoryFilteredCount,
    selectedCategoryId: selected.selectedCategoryId,
    categoryScoreShare: selected.scoreShare,
    isReliable: selected.isReliable,
    score,
  };
}

async function searchListingsForSingleImageSafely(
  imageBase64: string,
  imageIndex: number
): Promise<ImageStageEvaluation> {
  const startedAt = Date.now();

  try {
    return await searchListingsForSingleImage(imageBase64, imageIndex);
  } catch (error) {
    return {
      imageIndex,
      latencyMs: Date.now() - startedAt,
      rawListings: [],
      usedListings: [],
      selectedListings: [],
      accessoryFilteredCount: 0,
      selectedCategoryId: null,
      categoryScoreShare: 0,
      isReliable: false,
      score: 0,
      errorMessage: formatImageSearchError(error),
    };
  }
}

async function searchByImageRaw(
  imageBase64: string
): Promise<{ listings: ListingSummary[]; dominantCategoryId: string | null }> {
  const token = await getAccessToken();
  const env = getEnvironment();
  const url = new URL(`${getBaseUrl(env)}/buy/browse/v1/item_summary/search_by_image`);
  url.searchParams.set("limit", "24");
  url.searchParams.set("fieldgroups", "FULL");
  url.searchParams.set("filter", "conditions:{USED},buyingOptions:{FIXED_PRICE}");

  const response = await fetch(url.toString(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "X-EBAY-C-MARKETPLACE-ID": getMarketplaceId(),
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      image: imageBase64,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`eBay searchByImage failed: ${response.status} ${errorText}`);
  }

  const payload = await response.json();
  const items = Array.isArray(payload.itemSummaries) ? payload.itemSummaries : [];

  return {
    listings: items
      .map((item: unknown) => listingFromItem(item as Record<string, unknown>))
      .filter((item: ListingSummary | null): item is ListingSummary => item !== null),
    dominantCategoryId:
      typeof payload?.refinement?.dominantCategoryId === "string"
        ? payload.refinement.dominantCategoryId
        : null,
  };
}

function identifyFromListings(listings: ListingSummary[]): ProductIdentification {
  const topListing = listings[0];
  const brand = inferBrand(listings);
  const model = inferModel(listings, brand);
  const category = inferCategory(listings);
  const searchQuery = buildSearchQueryFromListings(listings);
  const title =
    brand && model
      ? `${brand} ${model}`
      : topListing?.title || "eBay画像検索結果";
  const confidence = scoreFromListings(listings);

  return {
    itemName: title,
    brand,
    model,
    category,
    categoryGroup: inferCategoryGroup(category, listings),
    conditionSummary: "eBay画像検索ベース",
    confidence,
    searchQuery,
    reasoning: "商品候補は eBay searchByImage の上位一致結果から合意抽出しています。",
  };
}

async function searchListingsByEbayImage(
  images: { data: string }[]
): Promise<SearchListingsResult> {
  const imageStages = await Promise.all(
    images.map((image, index) => searchListingsForSingleImageSafely(image.data, index))
  );
  const bestImageStage = pickBestImageStage(imageStages);
  const baseDebug: AppraisalDebug = {
    pipelineVersion: "2026-04-13-stage-split-v1",
    selectedImageIndex: bestImageStage?.imageIndex ?? null,
    imageStages: imageStages.map((stage) => toImageDebugStage(stage)),
    identificationProvider: "ebay-search-by-image",
    queryStage: null,
  };

  if (!bestImageStage || bestImageStage.selectedListings.length === 0) {
    return {
      identification: {
        itemName: "eBay画像検索結果なし",
        brand: "",
        model: "",
        category: "eBay画像検索",
        categoryGroup: "other",
        conditionSummary: "一致結果なし",
        confidence: 0,
        searchQuery: "",
        reasoning: "eBay searchByImage で一致結果を取得できませんでした。",
      },
      listings: [],
      accessoryFilteredCount: 0,
      debug: baseDebug,
    };
  }

  const identification = identifyFromListings(bestImageStage.selectedListings);
  const queryStartedAt = Date.now();
  const textSearchRaw = identification.searchQuery ? await searchRaw(identification.searchQuery) : [];
  const textSearchFiltered = filterTextSearchListings(
    textSearchRaw,
    bestImageStage.selectedCategoryId
  );
  const textSearchListings = dedupeListings(textSearchFiltered.listings);
  const queryStage: QuerySearchDebugStage = {
    query: identification.searchQuery,
    latencyMs: Date.now() - queryStartedAt,
    rawListingCount: textSearchRaw.length,
    filteredListingCount: textSearchListings.length,
    accessoryFilteredCount: textSearchFiltered.accessoryFilteredCount,
    dominantCategoryId: textSearchFiltered.dominantCategoryId,
    topTitles: textSearchListings.slice(0, 5).map((listing) => listing.title),
  };

  const finalListings =
    textSearchListings.length >= 3 ? textSearchListings : bestImageStage.selectedListings;
  const finalAccessoryFilteredCount =
    bestImageStage.accessoryFilteredCount +
    (textSearchListings.length >= 3 ? textSearchFiltered.accessoryFilteredCount : 0);
  const confidenceBase = scoreFromListings(bestImageStage.selectedListings);
  const queryBonus = textSearchListings.length >= 6 ? 0.1 : textSearchListings.length >= 3 ? 0.05 : 0;
  const confidence = Math.min(0.95, confidenceBase + queryBonus);

  return {
    identification: {
      ...identification,
      confidence,
      reasoning:
        textSearchListings.length >= 3
          ? "まず eBay searchByImage で最も一貫した画像から商品候補を作り、その検索語で eBay テキスト検索をかけて価格参照を集めています。"
          : "まず eBay searchByImage で最も一貫した画像から商品候補を作っています。テキスト検索の一致件数が不足したため、画像検索結果を価格参照に使っています。",
    },
    listings: finalListings,
    accessoryFilteredCount: finalAccessoryFilteredCount,
    debug: {
      ...baseDebug,
      queryStage,
    },
  };
}

type QueryCandidateSearch = {
  candidate: QueryCandidate;
  rawListings: ListingSummary[];
  filteredListings: ListingSummary[];
  accessoryFilteredCount: number;
  dominantCategoryId: string | null;
  latencyMs: number;
  score: number;
  errorMessage?: string | null;
};

type GeminiSearchAttempt = {
  mode: GeminiAttemptMode;
  inputImageCount: number;
  gemini: GeminiIdentification | null;
  candidates: QueryCandidate[];
  searches: QueryCandidateSearch[];
  bestSearch: QueryCandidateSearch | null;
  selectionScore: number;
  errorMessage?: string | null;
};

function scoreQueryCandidateSearch(search: Omit<QueryCandidateSearch, "score">): number {
  if (search.filteredListings.length === 0) {
    return 0;
  }

  const listingScore = Math.min(search.filteredListings.length, 12) * 12;
  const candidateScore = Math.min(45, search.candidate.score * 0.45);
  const accessoryPenalty = search.accessoryFilteredCount * 7;
  const candidateTokens = titleTokens(search.candidate.query).filter(
    (token) => token.length >= 3 && !TITLE_STOPWORDS.has(token)
  );
  const topTitleText = normalizeTitle(
    search.filteredListings
      .slice(0, 8)
      .map((listing) => listing.title)
      .join(" ")
  );
  const matchedTokenCount = candidateTokens.filter((token) => topTitleText.includes(token)).length;
  const queryFitScore =
    candidateTokens.length > 0 ? (matchedTokenCount / candidateTokens.length) * 30 : 0;

  return Math.max(0, listingScore + candidateScore + queryFitScore - accessoryPenalty);
}

async function searchQueryCandidateSafely(
  candidate: QueryCandidate
): Promise<QueryCandidateSearch> {
  const startedAt = Date.now();

  try {
    const rawListings = await searchRaw(candidate.query);
    const filtered = filterTextSearchListings(rawListings, null);
    const filteredListings = dedupeListings(filtered.listings);
    const withoutScore = {
      candidate,
      rawListings,
      filteredListings,
      accessoryFilteredCount: filtered.accessoryFilteredCount,
      dominantCategoryId: filtered.dominantCategoryId,
      latencyMs: Date.now() - startedAt,
      errorMessage: null,
    };

    return {
      ...withoutScore,
      score: scoreQueryCandidateSearch(withoutScore),
    };
  } catch (error) {
    return {
      candidate,
      rawListings: [],
      filteredListings: [],
      accessoryFilteredCount: 0,
      dominantCategoryId: null,
      latencyMs: Date.now() - startedAt,
      score: 0,
      errorMessage: error instanceof Error ? error.message : "eBayテキスト検索に失敗しました。",
    };
  }
}

function pickBestQueryCandidateSearch(
  searches: QueryCandidateSearch[]
): QueryCandidateSearch | null {
  const ranked = searches
    .filter((search) => search.filteredListings.length > 0)
    .sort((left, right) => {
      const minimumListingPreference =
        Number(right.filteredListings.length >= 3) - Number(left.filteredListings.length >= 3);

      if (minimumListingPreference !== 0) {
        return minimumListingPreference;
      }

      return right.score - left.score;
    });

  return ranked[0] || null;
}

function buildQueryCandidateStage(search: QueryCandidateSearch): QuerySearchDebugStage {
  return {
    query: search.candidate.query,
    latencyMs: search.latencyMs,
    rawListingCount: search.rawListings.length,
    filteredListingCount: search.filteredListings.length,
    accessoryFilteredCount: search.accessoryFilteredCount,
    dominantCategoryId: search.dominantCategoryId,
    topTitles: search.filteredListings.slice(0, 5).map((listing) => listing.title),
  };
}

function scoreGeminiSearchAttempt(attempt: {
  gemini: GeminiIdentification;
  bestSearch: QueryCandidateSearch | null;
}): number {
  if (!attempt.bestSearch || attempt.bestSearch.filteredListings.length === 0) {
    return 0;
  }

  const geminiConfidenceScore = attempt.gemini.confidence * 35;
  const exactnessScore = Math.min(20, attempt.bestSearch.candidate.score * 0.2);

  return attempt.bestSearch.score + geminiConfidenceScore + exactnessScore;
}

async function runGeminiSearchAttempt(
  mode: GeminiAttemptMode,
  images: { data: string; contentType?: string }[]
): Promise<GeminiSearchAttempt> {
  try {
    const gemini = await identifyWithGemini(images);
    const candidates = gemini.candidates.slice(0, MAX_GOOGLE_VISION_QUERY_CANDIDATES);
    const searches = await Promise.all(candidates.map(searchQueryCandidateSafely));
    const bestSearch = pickBestQueryCandidateSearch(searches);

    return {
      mode,
      inputImageCount: images.length,
      gemini,
      candidates,
      searches,
      bestSearch,
      selectionScore: scoreGeminiSearchAttempt({ gemini, bestSearch }),
      errorMessage: null,
    };
  } catch (error) {
    return {
      mode,
      inputImageCount: images.length,
      gemini: null,
      candidates: [],
      searches: [],
      bestSearch: null,
      selectionScore: 0,
      errorMessage: error instanceof Error ? error.message : "Gemini 3 画像同定に失敗しました。",
    };
  }
}

function pickBestGeminiAttempt(attempts: GeminiSearchAttempt[]): GeminiSearchAttempt {
  const primaryAttempt = attempts.find((attempt) => attempt.mode === "primary-only");
  const allImagesAttempt = attempts.find((attempt) => attempt.mode === "all-images");

  if (!primaryAttempt) {
    return attempts[0];
  }

  if (
    allImagesAttempt &&
    allImagesAttempt.bestSearch &&
    (!primaryAttempt.bestSearch ||
      allImagesAttempt.selectionScore >=
        primaryAttempt.selectionScore + GEMINI_ALL_IMAGES_SELECTION_MARGIN)
  ) {
    return allImagesAttempt;
  }

  return primaryAttempt;
}

function buildEmptyGoogleVisionIdentification(
  query: string,
  reasoning: string
): ProductIdentification {
  return {
    itemName: query || "Google Vision 品名候補なし",
    brand: "",
    model: "",
    category: "Google Vision Web Detection",
    categoryGroup: "other",
    conditionSummary: "一致結果なし",
    confidence: 0,
    searchQuery: query,
    reasoning,
  };
}

async function searchListingsByGoogleVision(images: { data: string }[]): Promise<SearchListingsResult> {
  const vision = await identifyWithGoogleVision(images);
  const candidates = vision.candidates.slice(0, MAX_GOOGLE_VISION_QUERY_CANDIDATES);
  const searches = await Promise.all(candidates.map(searchQueryCandidateSafely));
  const bestSearch = pickBestQueryCandidateSearch(searches);
  const topCandidate = candidates[0] || null;
  const baseDebug: AppraisalDebug = {
    pipelineVersion: "2026-04-22-google-vision-web-detection-v1",
    selectedImageIndex: bestSearch?.candidate.imageIndex ?? topCandidate?.imageIndex ?? null,
    imageStages: [],
    visionStages: vision.stages,
    identificationProvider: "google-vision-web-detection",
    queryStage: bestSearch ? buildQueryCandidateStage(bestSearch) : null,
  };

  if (!bestSearch || bestSearch.filteredListings.length === 0) {
    return {
      identification: buildEmptyGoogleVisionIdentification(
        topCandidate?.query || "",
        topCandidate
          ? "Google Cloud Vision Web Detection で品名候補は出ましたが、eBayテキスト検索で価格参照を取得できませんでした。"
          : "Google Cloud Vision Web Detection で十分な品名候補を取得できませんでした。"
      ),
      listings: [],
      accessoryFilteredCount: 0,
      debug: baseDebug,
    };
  }

  const identification = identifyFromListings(bestSearch.filteredListings);
  const confidence = Math.min(
    0.95,
    scoreFromListings(bestSearch.filteredListings) + Math.min(0.15, bestSearch.candidate.score / 700)
  );

  return {
    identification: {
      ...identification,
      conditionSummary: "Google Cloud Vision Web Detection ベース",
      confidence,
      searchQuery: bestSearch.candidate.query,
      reasoning:
        "Google Cloud Vision Web Detection で品名候補を作り、その検索語で eBay テキスト検索をかけて価格参照を集めています。",
    },
    listings: bestSearch.filteredListings,
    accessoryFilteredCount: bestSearch.accessoryFilteredCount,
    debug: baseDebug,
  };
}

function buildEmptyGeminiIdentification(
  itemName: string,
  query: string,
  category: string,
  categoryGroup: string,
  reasoning: string
): ProductIdentification {
  return {
    itemName: itemName || query || "Gemini 品名候補なし",
    brand: "",
    model: "",
    category: category || "Gemini image understanding",
    categoryGroup: categoryGroup || "other",
    conditionSummary: "一致結果なし",
    confidence: 0,
    searchQuery: query,
    reasoning,
  };
}

async function searchListingsByGemini(
  images: { data: string; contentType?: string }[]
): Promise<SearchListingsResult> {
  const attempts = await Promise.all([
    runGeminiSearchAttempt("primary-only", [images[0]]),
    ...(images.length > 1 ? [runGeminiSearchAttempt("all-images", images)] : []),
  ]);
  const selectedAttempt = pickBestGeminiAttempt(attempts);
  const gemini = selectedAttempt.gemini;
  const candidates = selectedAttempt.candidates;
  const bestSearch = selectedAttempt.bestSearch;
  const topCandidate = candidates[0] || null;
  const attemptDebug = attempts.map((attempt) => ({
    mode: attempt.mode,
    usedImageCount: attempt.inputImageCount,
    itemName: attempt.gemini?.itemName || "",
    topQuery: attempt.candidates[0]?.query || "",
    listingCount: attempt.bestSearch?.filteredListings.length || 0,
    selectionScore: Number(attempt.selectionScore.toFixed(1)),
    selected: attempt === selectedAttempt,
    errorMessage: attempt.errorMessage || null,
  }));
  const selectedGeminiStage = gemini
    ? {
        ...gemini.stage,
        mode: selectedAttempt.mode,
        attempts: attemptDebug,
        warning:
          selectedAttempt.mode === "primary-only" && attempts.length > 1
            ? "追加画像ありの同定結果も比較しましたが、1枚目のみの結果を採用しました。"
            : gemini.stage.warning,
      }
    : {
        provider: "gemini" as const,
        model: process.env.GEMINI_MODEL || "gemini-3-pro-preview",
        mode: selectedAttempt.mode,
        latencyMs: 0,
        itemName: "",
        brand: "",
        modelName: "",
        category: "",
        confidence: 0,
        usedImageCount: selectedAttempt.inputImageCount,
        queryCandidates: [],
        evidence: [],
        warning: null,
        attempts: attemptDebug,
        errorMessage:
          selectedAttempt.errorMessage ||
          attempts.find((attempt) => attempt.errorMessage)?.errorMessage ||
          null,
      };
  const baseDebug: AppraisalDebug = {
    pipelineVersion: "2026-04-22-gemini-3-image-understanding-v1",
    selectedImageIndex: bestSearch?.candidate.imageIndex ?? topCandidate?.imageIndex ?? null,
    imageStages: [],
    geminiStage: selectedGeminiStage,
    identificationProvider: "gemini-3-image-understanding",
    queryStage: bestSearch ? buildQueryCandidateStage(bestSearch) : null,
  };

  if (!bestSearch || bestSearch.filteredListings.length === 0) {
    return {
      identification: buildEmptyGeminiIdentification(
        gemini?.itemName || "",
        topCandidate?.query || "",
        gemini?.category || "",
        gemini?.categoryGroup || "",
        topCandidate
          ? "Gemini 3 で品名候補は出ましたが、eBayテキスト検索で価格参照を取得できませんでした。"
          : "Gemini 3 で十分な品名候補を取得できませんでした。"
      ),
      listings: [],
      accessoryFilteredCount: 0,
      debug: baseDebug,
    };
  }

  if (!gemini) {
    return {
      identification: buildEmptyGeminiIdentification(
        "",
        "",
        "",
        "",
        "Gemini 3 の画像同定に失敗しました。"
      ),
      listings: [],
      accessoryFilteredCount: 0,
      debug: baseDebug,
    };
  }

  const identification = identifyFromListings(bestSearch.filteredListings);
  const listingConfidence = scoreFromListings(bestSearch.filteredListings);
  const queryConfidence = Math.min(0.15, bestSearch.candidate.score / 700);
  const confidence = Math.min(
    0.97,
    Math.max(listingConfidence, gemini.confidence * 0.7 + listingConfidence * 0.25 + queryConfidence)
  );

  return {
    identification: {
      ...identification,
      itemName: gemini.itemName || identification.itemName,
      brand: gemini.brand || identification.brand,
      model: gemini.model || identification.model,
      category: gemini.category || identification.category,
      categoryGroup: gemini.categoryGroup || identification.categoryGroup,
      conditionSummary: "Gemini 3 画像同定ベース",
      confidence,
      searchQuery: bestSearch.candidate.query,
      reasoning:
        attempts.length > 1
          ? `Gemini 3 で1枚目のみと全画像の品名候補を比較し、${selectedAttempt.mode === "all-images" ? "全画像" : "1枚目のみ"}の結果を採用して eBay テキスト検索で価格参照を集めています。`
          : "Gemini 3 の画像入力で品名候補を作り、その検索語で eBay テキスト検索をかけて価格参照を集めています。",
    },
    listings: bestSearch.filteredListings,
    accessoryFilteredCount: bestSearch.accessoryFilteredCount,
    debug: baseDebug,
  };
}

function attachGoogleVisionAttemptToFallback(
  fallback: SearchListingsResult,
  googleAttempt: SearchListingsResult
): SearchListingsResult {
  return {
    ...fallback,
    debug: {
      ...fallback.debug,
      pipelineVersion: "2026-04-22-google-vision-web-detection-v1-fallback-ebay-image",
      visionStages: googleAttempt.debug.visionStages,
      identificationProvider: "ebay-search-by-image",
    },
  };
}

export async function searchListingsByImage(images: { data: string }[]): Promise<SearchListingsResult> {
  const provider = getImageIdentificationProvider();

  if (provider === "ebay-image") {
    return searchListingsByEbayImage(images);
  }

  if (provider === "gemini" || (provider === "auto" && isGeminiConfigured())) {
    const geminiAttempt = await searchListingsByGemini(images);

    if (geminiAttempt.listings.length > 0 || provider === "gemini") {
      return geminiAttempt;
    }
  }

  if (provider === "google-vision" || (provider === "auto" && isGoogleVisionConfigured())) {
    const googleAttempt = await searchListingsByGoogleVision(images);

    if (googleAttempt.listings.length > 0 || provider === "google-vision") {
      return googleAttempt;
    }

    const fallback = await searchListingsByEbayImage(images);
    return attachGoogleVisionAttemptToFallback(fallback, googleAttempt);
  }

  return searchListingsByEbayImage(images);
}
