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

export type AppraisalResult = {
  identification: ProductIdentification;
  pricing: PricingSummary;
  listings: ListingSummary[];
  warnings: string[];
};
