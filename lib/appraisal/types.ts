export type ProductIdentification = {
  itemName: string;
  brand: string;
  model: string;
  category: string;
  categoryGroup: string;
  conditionSummary: string;
  confidence: number;
  searchQuery: string;
  reasoning: string;
};

export type PricePoint = {
  amount: number;
  currency: string;
};

export type ListingSummary = {
  id: string;
  title: string;
  condition: string;
  itemWebUrl: string;
  imageUrl: string | null;
  leafCategoryIds: string[];
  categoryPath: string[];
  price: PricePoint;
  shipping: PricePoint | null;
  totalPrice: PricePoint;
  seller: string;
  location: string;
};

export type PricingSummary = {
  listingCount: number;
  low: number;
  median: number;
  high: number;
  suggestedMaxPrice: number;
  buyPriceRangeLow: number;
  buyPriceRangeHigh: number;
  categoryRatio: number;
  confidenceAdjustment: number;
  formula: string;
};

export type AppraisalHistoryImage = {
  url: string;
  pathname: string;
  slotLabel: string;
};

export type AppraisalHistoryPricing = {
  suggestedMaxPrice: number;
  buyPriceRangeLow: number;
  buyPriceRangeHigh: number;
  low: number;
  median: number;
  high: number;
  listingCount: number;
};

export type AppraisalHistoryItem = {
  id: string;
  createdAt: string;
  images: AppraisalHistoryImage[];
  identification: ProductIdentification;
  pricing: AppraisalHistoryPricing;
};

export type ImageSearchDebugStage = {
  imageIndex: number;
  latencyMs: number;
  rawListingCount: number;
  usedListingCount: number;
  selectedListingCount: number;
  accessoryFilteredCount: number;
  selectedCategoryId: string | null;
  categoryScoreShare: number;
  isReliable: boolean;
  score: number;
  topTitles: string[];
};

export type QuerySearchDebugStage = {
  query: string;
  latencyMs: number;
  rawListingCount: number;
  filteredListingCount: number;
  accessoryFilteredCount: number;
  dominantCategoryId: string | null;
  topTitles: string[];
};

export type AppraisalDebug = {
  pipelineVersion: string;
  selectedImageIndex: number | null;
  imageStages: ImageSearchDebugStage[];
  queryStage: QuerySearchDebugStage | null;
};

export type AppraisalResult = {
  identification: ProductIdentification;
  pricing: PricingSummary;
  listings: ListingSummary[];
  warnings: string[];
  debug?: AppraisalDebug;
  savedHistoryId?: string | null;
  savedHistoryAt?: string | null;
  savedHistoryItem?: AppraisalHistoryItem | null;
};
