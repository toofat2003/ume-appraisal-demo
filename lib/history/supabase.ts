import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { AppraisalHistoryItem } from "@/lib/appraisal/types";
import {
  DEFAULT_HISTORY_LIMIT,
  getExtension,
  mapPricing,
  SaveAppraisalHistoryInput,
  sanitizeSegment,
} from "@/lib/history/shared";

const SUPABASE_BUCKET = process.env.SUPABASE_HISTORY_BUCKET || "appraisal-images";

let adminClient: SupabaseClient | null = null;
let ensureBucketPromise: Promise<void> | null = null;

type SessionRow = {
  id: string;
  created_at: string;
  item_name: string;
  brand: string;
  model: string;
  category: string;
  category_group: string;
  condition_summary: string;
  confidence: number;
  search_query: string;
  reasoning: string;
  suggested_max_price: number;
  buy_price_range_low: number;
  buy_price_range_high: number;
  low_price: number;
  median_price: number;
  high_price: number;
  listing_count: number;
  appraisal_images?: ImageRow[];
};

type ImageRow = {
  slot_label: string;
  storage_path: string;
  public_url: string;
  position: number;
};

function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

function getClient(): SupabaseClient {
  if (!isSupabaseConfigured()) {
    throw new Error("Supabase history storage is not configured");
  }

  if (adminClient) {
    return adminClient;
  }

  adminClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    }
  );

  return adminClient;
}

async function ensureBucket(): Promise<void> {
  if (ensureBucketPromise) {
    return ensureBucketPromise;
  }

  ensureBucketPromise = (async () => {
    const client = getClient();
    const { data: buckets, error: bucketsError } = await client.storage.listBuckets();

    if (bucketsError) {
      throw bucketsError;
    }

    const bucketExists = buckets?.some((bucket) => bucket.id === SUPABASE_BUCKET);
    if (bucketExists) {
      return;
    }

    const { error: createError } = await client.storage.createBucket(SUPABASE_BUCKET, {
      public: true,
      allowedMimeTypes: ["image/*"],
      fileSizeLimit: "5MB",
    });

    if (createError && !createError.message.toLowerCase().includes("already exists")) {
      throw createError;
    }
  })();

  try {
    await ensureBucketPromise;
  } catch (error) {
    ensureBucketPromise = null;
    throw error;
  }
}

function mapSessionRowToHistoryItem(row: SessionRow): AppraisalHistoryItem {
  return {
    id: row.id,
    createdAt: row.created_at,
    images: [...(row.appraisal_images || [])]
      .sort((a, b) => a.position - b.position)
      .map((image) => ({
        url: image.public_url,
        pathname: image.storage_path,
        slotLabel: image.slot_label,
      })),
    identification: {
      itemName: row.item_name,
      brand: row.brand,
      model: row.model,
      category: row.category,
      categoryGroup: row.category_group,
      conditionSummary: row.condition_summary,
      confidence: row.confidence,
      searchQuery: row.search_query,
      reasoning: row.reasoning,
    },
    pricing: {
      suggestedMaxPrice: row.suggested_max_price,
      buyPriceRangeLow: row.buy_price_range_low,
      buyPriceRangeHigh: row.buy_price_range_high,
      low: row.low_price,
      median: row.median_price,
      high: row.high_price,
      listingCount: row.listing_count,
    },
  };
}

export async function saveAppraisalHistoryToSupabase(
  input: SaveAppraisalHistoryInput
): Promise<AppraisalHistoryItem | null> {
  if (!isSupabaseConfigured() || input.images.length === 0) {
    return null;
  }

  await ensureBucket();

  const client = getClient();
  const sessionId = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  const uploadedImages = await Promise.all(
    input.images.map(async ({ file, slotLabel }, index) => {
      const storagePath = `${sessionId}/${String(index + 1).padStart(2, "0")}-${sanitizeSegment(
        slotLabel
      )}.${getExtension(file)}`;

      const { data: uploadData, error: uploadError } = await client.storage
        .from(SUPABASE_BUCKET)
        .upload(storagePath, file, {
          contentType: file.type || "image/jpeg",
          cacheControl: "3600",
          upsert: false,
        });

      if (uploadError) {
        throw uploadError;
      }

      const { data: publicData } = client.storage
        .from(SUPABASE_BUCKET)
        .getPublicUrl(uploadData.path);

      return {
        slot_label: slotLabel,
        storage_path: uploadData.path,
        public_url: publicData.publicUrl,
        position: index,
        mime_type: file.type || "image/jpeg",
      };
    })
  );

  const { error: sessionError } = await client.from("appraisal_sessions").insert({
    id: sessionId,
    created_at: createdAt,
    item_name: input.identification.itemName,
    brand: input.identification.brand,
    model: input.identification.model,
    category: input.identification.category,
    category_group: input.identification.categoryGroup,
    condition_summary: input.identification.conditionSummary,
    confidence: input.identification.confidence,
    search_query: input.identification.searchQuery,
    reasoning: input.identification.reasoning,
    suggested_max_price: input.pricing.suggestedMaxPrice,
    buy_price_range_low: input.pricing.buyPriceRangeLow,
    buy_price_range_high: input.pricing.buyPriceRangeHigh,
    low_price: input.pricing.low,
    median_price: input.pricing.median,
    high_price: input.pricing.high,
    listing_count: input.pricing.listingCount,
    raw_result_json: input.rawResult ?? {},
  });

  if (sessionError) {
    throw sessionError;
  }

  const { error: imageInsertError } = await client.from("appraisal_images").insert(
    uploadedImages.map((image) => ({
      session_id: sessionId,
      ...image,
    }))
  );

  if (imageInsertError) {
    throw imageInsertError;
  }

  return {
    id: sessionId,
    createdAt,
    images: uploadedImages
      .sort((a, b) => a.position - b.position)
      .map((image) => ({
        url: image.public_url,
        pathname: image.storage_path,
        slotLabel: image.slot_label,
      })),
    identification: input.identification,
    pricing: mapPricing(input.pricing),
  };
}

export async function listAppraisalHistoryFromSupabase(
  limit = DEFAULT_HISTORY_LIMIT
): Promise<AppraisalHistoryItem[]> {
  if (!isSupabaseConfigured()) {
    return [];
  }

  const client = getClient();
  const { data, error } = await client
    .from("appraisal_sessions")
    .select(
      `
        id,
        created_at,
        item_name,
        brand,
        model,
        category,
        category_group,
        condition_summary,
        confidence,
        search_query,
        reasoning,
        suggested_max_price,
        buy_price_range_low,
        buy_price_range_high,
        low_price,
        median_price,
        high_price,
        listing_count,
        appraisal_images (
          slot_label,
          storage_path,
          public_url,
          position
        )
      `
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw error;
  }

  return (data || []).map((row) => mapSessionRowToHistoryItem(row as SessionRow));
}

export function isSupabaseHistoryStorageEnabled(): boolean {
  return isSupabaseConfigured();
}
