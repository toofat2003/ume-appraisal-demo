import {
  AppraisalDebug,
  ImageSearchDebugStage,
  ListingSummary,
  PricePoint,
  ProductIdentification,
  QuerySearchDebugStage,
} from "@/lib/appraisal/types";

const DEFAULT_MARKETPLACE_ID = "EBAY_US";
const OAUTH_SCOPE = "https://api.ebay.com/oauth/api_scope";

type EbayEnvironment = "production" | "sandbox";

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

const TITLE_STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "automatic",
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
  "gold",
  "good",
  "gray",
  "green",
  "in",
  "japan",
  "large",
  "ladies",
  "leather",
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
  "steel",
  "the",
  "unworn",
  "used",
  "watch",
  "white",
  "with",
  "wristwatch",
  "w",
]);

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

  if (categoryText.includes("watch")) {
    return "watch";
  }
  if (categoryText.includes("jewelry")) {
    return "jewelry";
  }
  if (
    categoryText.includes("bag") ||
    categoryText.includes("handbag") ||
    categoryText.includes("wallet") ||
    categoryText.includes("fashion")
  ) {
    return "fashion";
  }
  if (
    categoryText.includes("phone") ||
    categoryText.includes("laptop") ||
    categoryText.includes("electronics")
  ) {
    return "electronics";
  }
  if (categoryText.includes("tool")) {
    return "tools";
  }
  if (categoryText.includes("collect")) {
    return "collectible";
  }
  if (categoryText.includes("appliance")) {
    return "appliance";
  }
  if (categoryText.includes("home")) {
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
  };
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

export async function searchListingsByImage(
  images: { data: string }[]
): Promise<{
  identification: ProductIdentification;
  listings: ListingSummary[];
  accessoryFilteredCount: number;
  debug: AppraisalDebug;
}> {
  const imageStages = await Promise.all(
    images.map((image, index) => searchListingsForSingleImage(image.data, index))
  );
  const bestImageStage = pickBestImageStage(imageStages);
  const baseDebug: AppraisalDebug = {
    pipelineVersion: "2026-04-13-stage-split-v1",
    selectedImageIndex: bestImageStage?.imageIndex ?? null,
    imageStages: imageStages.map((stage) => toImageDebugStage(stage)),
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
