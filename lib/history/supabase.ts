import { createClient, SupabaseClient } from "@supabase/supabase-js";
import {
  AppraisalConditionRank,
  AppraisalHistoryImage,
  AppraisalHistoryItem,
} from "@/lib/appraisal/types";
import {
  DEFAULT_HISTORY_LIMIT,
  ListAppraisalHistoryOptions,
  RenameAppointmentResult,
  getExtension,
  mapPricing,
  SaveAppraisalHistoryImagesInput,
  SaveAppraisalHistoryInput,
  SaveAppraisalHistorySessionInput,
  UpdateAppraisalHistoryItemInput,
  sanitizeSegment,
} from "@/lib/history/shared";

const SUPABASE_BUCKET = process.env.SUPABASE_HISTORY_BUCKET || "appraisal-images";

let adminClient: SupabaseClient | null = null;
let ensureBucketPromise: Promise<void> | null = null;

type SessionRow = {
  id: string;
  created_at: string;
  appointment_id: string | null;
  appointment_label: string | null;
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
  manual_max_price: number | null;
  condition_rank: string | null;
  offer_price: number | null;
  contract_price: number | null;
  is_excluded: boolean | null;
  is_contracted: boolean | null;
  appraisal_images?: ImageRow[];
};

type ImageRow = {
  slot_label: string;
  storage_path: string;
  public_url: string;
  position: number;
};

type UploadedImageRow = ImageRow & {
  mime_type: string;
};

const SESSION_SELECT = `
  id,
  created_at,
  appointment_id,
  appointment_label,
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
  manual_max_price,
  condition_rank,
  offer_price,
  contract_price,
  is_excluded,
  is_contracted,
  appraisal_images (
    slot_label,
    storage_path,
    public_url,
    position
  )
`;

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

function mapImageRowsToHistoryImages(images: ImageRow[] = []): AppraisalHistoryImage[] {
  return [...images]
    .sort((a, b) => a.position - b.position)
    .map((image) => ({
      url: image.public_url,
      pathname: image.storage_path,
      slotLabel: image.slot_label,
    }));
}

function mapConditionRank(value: string | null | undefined): AppraisalConditionRank | null {
  return value === "A" || value === "B" || value === "C" ? value : null;
}

function mapSessionRowToHistoryItem(row: SessionRow): AppraisalHistoryItem {
  return {
    id: row.id,
    createdAt: row.created_at,
    appointmentId: row.appointment_id,
    appointmentLabel: row.appointment_label,
    images: mapImageRowsToHistoryImages(row.appraisal_images || []),
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
    manualMaxPrice: row.manual_max_price ?? null,
    conditionRank: mapConditionRank(row.condition_rank),
    offerPrice: row.offer_price ?? null,
    contractPrice: row.contract_price ?? null,
    isExcluded: Boolean(row.is_excluded),
    isContracted: Boolean(row.is_contracted),
  };
}

function buildHistoryItemFromInput(
  id: string,
  createdAt: string,
  input: SaveAppraisalHistorySessionInput,
  images: ImageRow[] = []
): AppraisalHistoryItem {
  return {
    id,
    createdAt,
    appointmentId: input.appointmentId || null,
    appointmentLabel: input.appointmentLabel || null,
    images: mapImageRowsToHistoryImages(images),
    identification: input.identification,
    pricing: mapPricing(input.pricing),
    manualMaxPrice: input.manualMaxPrice ?? null,
    conditionRank: input.conditionRank ?? null,
    offerPrice: input.offerPrice ?? null,
    contractPrice: input.contractPrice ?? input.offerPrice ?? null,
    isExcluded: Boolean(input.isExcluded),
    isContracted: Boolean(input.isContracted),
  };
}

export async function createAppraisalHistorySessionInSupabase(
  input: SaveAppraisalHistorySessionInput
): Promise<AppraisalHistoryItem | null> {
  if (!isSupabaseConfigured()) {
    return null;
  }

  const client = getClient();
  const sessionId = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  const { error: sessionError } = await client.from("appraisal_sessions").insert({
    id: sessionId,
    created_at: createdAt,
    appointment_id: input.appointmentId || null,
    appointment_label: input.appointmentLabel || null,
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
    manual_max_price: input.manualMaxPrice ?? null,
    condition_rank: input.conditionRank ?? null,
    offer_price: input.offerPrice ?? null,
    contract_price: input.contractPrice ?? input.offerPrice ?? null,
    is_excluded: Boolean(input.isExcluded),
    is_contracted: Boolean(input.isContracted),
    raw_result_json: input.rawResult ?? {},
  });

  if (sessionError) {
    throw sessionError;
  }

  return buildHistoryItemFromInput(sessionId, createdAt, input);
}

export async function saveAppraisalHistoryImagesToSupabase(
  input: SaveAppraisalHistoryImagesInput
): Promise<AppraisalHistoryImage[]> {
  if (!isSupabaseConfigured() || input.images.length === 0) {
    return [];
  }

  await ensureBucket();

  const client = getClient();
  const uploadedImages: UploadedImageRow[] = await Promise.all(
    input.images.map(async ({ file, slotLabel }, index) => {
      const storagePath = `${input.sessionId}/${String(index + 1).padStart(2, "0")}-${sanitizeSegment(
        slotLabel
      )}.${getExtension(file)}`;

      const { data: uploadData, error: uploadError } = await client.storage
        .from(SUPABASE_BUCKET)
        .upload(storagePath, file, {
          contentType: file.type || "image/jpeg",
          cacheControl: "3600",
          upsert: true,
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

  const { error: imageInsertError } =
    uploadedImages.length > 0
      ? await client.from("appraisal_images").upsert(
          uploadedImages.map((image) => ({
            session_id: input.sessionId,
            ...image,
          })),
          { onConflict: "storage_path" }
        )
      : { error: null };

  if (imageInsertError) {
    throw imageInsertError;
  }

  return mapImageRowsToHistoryImages(uploadedImages);
}

export async function saveAppraisalHistoryToSupabase(
  input: SaveAppraisalHistoryInput
): Promise<AppraisalHistoryItem | null> {
  const session = await createAppraisalHistorySessionInSupabase(input);

  if (!session || input.images.length === 0) {
    return session;
  }

  const images = await saveAppraisalHistoryImagesToSupabase({
    sessionId: session.id,
    createdAt: session.createdAt,
    images: input.images,
  });

  return {
    ...session,
    images,
  };
}

export async function listAppraisalHistoryFromSupabase(
  options: ListAppraisalHistoryOptions = {}
): Promise<AppraisalHistoryItem[]> {
  if (!isSupabaseConfigured()) {
    return [];
  }

  const limit = options.limit ?? DEFAULT_HISTORY_LIMIT;
  const client = getClient();
  let query = client
    .from("appraisal_sessions")
    .select(SESSION_SELECT)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (options.itemId) {
    query = query.eq("id", options.itemId).limit(1);
  }

  if (options.appointmentId) {
    query = query.eq("appointment_id", options.appointmentId);
  }

  const { data, error } = await query;

  if (error) {
    throw error;
  }

  return (data || []).map((row) => mapSessionRowToHistoryItem(row as SessionRow));
}

export async function updateAppraisalHistoryItemInSupabase(
  input: UpdateAppraisalHistoryItemInput
): Promise<AppraisalHistoryItem | null> {
  if (!isSupabaseConfigured()) {
    return null;
  }

  const updatePayload: Record<string, number | boolean | string | null> = {};

  if ("manualMaxPrice" in input) {
    updatePayload.manual_max_price = input.manualMaxPrice ?? null;
  }

  if ("conditionRank" in input) {
    updatePayload.condition_rank = input.conditionRank ?? null;
  }

  if ("offerPrice" in input) {
    updatePayload.offer_price = input.offerPrice ?? null;
    updatePayload.contract_price = input.offerPrice ?? null;
  }

  if ("contractPrice" in input) {
    updatePayload.contract_price = input.contractPrice ?? null;
  }

  if ("isExcluded" in input && typeof input.isExcluded === "boolean") {
    updatePayload.is_excluded = input.isExcluded;
  }

  if ("isContracted" in input && typeof input.isContracted === "boolean") {
    updatePayload.is_contracted = input.isContracted;
  }

  if (Object.keys(updatePayload).length === 0) {
    const [existing] = await listAppraisalHistoryFromSupabase({
      itemId: input.itemId,
      limit: 1,
    });
    return existing || null;
  }

  const client = getClient();
  const { data, error } = await client
    .from("appraisal_sessions")
    .update(updatePayload)
    .eq("id", input.itemId)
    .select(SESSION_SELECT)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data ? mapSessionRowToHistoryItem(data as SessionRow) : null;
}

export async function renameAppointmentInSupabase(
  appointmentId: string,
  appointmentLabel: string
): Promise<RenameAppointmentResult> {
  if (!isSupabaseConfigured()) {
    return {
      appointmentId,
      appointmentLabel,
      updatedCount: 0,
    };
  }

  const client = getClient();
  const { data, error } = await client
    .from("appraisal_sessions")
    .update({
      appointment_label: appointmentLabel,
    })
    .eq("appointment_id", appointmentId)
    .select("id");

  if (error) {
    throw error;
  }

  return {
    appointmentId,
    appointmentLabel,
    updatedCount: data?.length || 0,
  };
}

export function isSupabaseHistoryStorageEnabled(): boolean {
  return isSupabaseConfigured();
}
