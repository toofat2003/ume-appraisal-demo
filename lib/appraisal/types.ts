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
  appointmentId: string | null;
  appointmentLabel: string | null;
  images: AppraisalHistoryImage[];
  identification: ProductIdentification;
  pricing: AppraisalHistoryPricing;
  manualMaxPrice: number | null;
  offerPrice: number | null;
  contractPrice: number | null;
  isExcluded: boolean;
  isContracted: boolean;
};

export type AppraisalAppointmentGroup = {
  appointmentId: string | null;
  appointmentLabel: string;
  latestAppraisalAt: string;
  itemCount: number;
  totalItemCount: number;
  excludedItemCount: number;
  totalSuggestedMaxPrice: number;
  totalOfferPrice: number;
  totalContractPrice: number;
  totalContractedSuggestedMaxPrice: number;
  totalContractedOfferPrice: number;
  totalContractedGrossProfit: number;
  items: AppraisalHistoryItem[];
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
  errorMessage?: string | null;
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

export type VisionCandidateDebug = {
  query: string;
  score: number;
  source: string;
};

export type VisionImageDebugStage = {
  imageIndex: number;
  provider: "google-vision";
  latencyMs: number;
  bestGuessLabels: string[];
  webEntities: VisionCandidateDebug[];
  logoDescriptions: string[];
  textSnippets: string[];
  candidateQueries: VisionCandidateDebug[];
  errorMessage?: string | null;
};

export type GeminiQueryCandidateDebug = {
  query: string;
  score: number;
  reason: string;
};

export type GeminiAttemptDebug = {
  mode: "primary-only" | "all-images";
  usedImageCount: number;
  itemName: string;
  topQuery: string;
  listingCount: number;
  selectionScore: number;
  selected: boolean;
  errorMessage?: string | null;
};

export type GeminiIdentificationDebug = {
  provider: "gemini";
  model: string;
  mode?: "primary-only" | "all-images";
  latencyMs: number;
  itemName: string;
  brand: string;
  modelName: string;
  category: string;
  confidence: number;
  usedImageCount: number;
  queryCandidates: GeminiQueryCandidateDebug[];
  evidence: string[];
  warning?: string | null;
  attempts?: GeminiAttemptDebug[];
  errorMessage?: string | null;
};

export type AppraisalDebug = {
  pipelineVersion: string;
  selectedImageIndex: number | null;
  imageStages: ImageSearchDebugStage[];
  visionStages?: VisionImageDebugStage[];
  geminiStage?: GeminiIdentificationDebug;
  identificationProvider?:
    | "google-vision-web-detection"
    | "gemini-3-image-understanding"
    | "ebay-search-by-image";
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
