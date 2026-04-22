import { list, put } from "@vercel/blob";
import { AppraisalHistoryImage, AppraisalHistoryItem } from "@/lib/appraisal/types";
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

function getHistoryRecordPathname(item: AppraisalHistoryItem): string {
  return `${getHistoryRecordPrefix()}${item.createdAt.replace(/[:.]/g, "-")}_${item.id}.json`;
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
  if (!isAppraisalHistoryItem(payload)) {
    return null;
  }

  return {
    ...payload,
    manualMaxPrice:
      typeof payload.manualMaxPrice === "number" && Number.isFinite(payload.manualMaxPrice)
        ? payload.manualMaxPrice
        : null,
    offerPrice:
      typeof payload.offerPrice === "number" && Number.isFinite(payload.offerPrice)
        ? payload.offerPrice
        : null,
    contractPrice:
      typeof payload.contractPrice === "number" && Number.isFinite(payload.contractPrice)
        ? payload.contractPrice
        : null,
    isExcluded: Boolean(payload.isExcluded),
    isContracted: Boolean(payload.isContracted),
  };
}

async function putHistoryRecord(item: AppraisalHistoryItem): Promise<void> {
  await put(getHistoryRecordPathname(item), JSON.stringify(item, null, 2), {
    access: "public",
    addRandomSuffix: false,
    contentType: "application/json; charset=utf-8",
    cacheControlMaxAge: 60,
  });
}

async function uploadHistoryImages(
  id: string,
  images: SaveAppraisalHistoryInput["images"]
): Promise<AppraisalHistoryImage[]> {
  return Promise.all(
    images.map(async ({ file, slotLabel }, index) => {
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
}

async function findHistoryRecordById(
  id: string
): Promise<AppraisalHistoryItem | null> {
  const page = await list({
    prefix: getHistoryRecordPrefix(),
    limit: 500,
  });

  const recordBlob = page.blobs.find((blob) =>
    blob.pathname.endsWith(`_${id}.json`)
  );

  return recordBlob ? fetchHistoryRecord(recordBlob.url) : null;
}

export async function createAppraisalHistorySessionInBlob(
  input: SaveAppraisalHistorySessionInput
): Promise<AppraisalHistoryItem | null> {
  if (!isBlobConfigured()) {
    return null;
  }

  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const item: AppraisalHistoryItem = {
    id,
    createdAt,
    appointmentId: input.appointmentId || null,
    appointmentLabel: input.appointmentLabel || null,
    images: [],
    identification: input.identification,
    pricing: mapPricing(input.pricing),
    manualMaxPrice: input.manualMaxPrice ?? null,
    offerPrice: input.offerPrice ?? null,
    contractPrice: input.contractPrice ?? input.offerPrice ?? null,
    isExcluded: Boolean(input.isExcluded),
    isContracted: Boolean(input.isContracted),
  };

  await putHistoryRecord(item);

  return item;
}

export async function saveAppraisalHistoryImagesInBlob(
  input: SaveAppraisalHistoryImagesInput
): Promise<AppraisalHistoryImage[]> {
  if (!isBlobConfigured() || input.images.length === 0) {
    return [];
  }

  const item = await findHistoryRecordById(input.sessionId);

  if (!item) {
    throw new Error("Blob history record was not found for image save");
  }

  const images = await uploadHistoryImages(input.sessionId, input.images);
  await putHistoryRecord({
    ...item,
    images,
  });

  return images;
}

export async function saveAppraisalHistory(
  input: SaveAppraisalHistoryInput
): Promise<AppraisalHistoryItem | null> {
  const session = await createAppraisalHistorySessionInBlob(input);

  if (!session || input.images.length === 0) {
    return session;
  }

  const images = await saveAppraisalHistoryImagesInBlob({
    sessionId: session.id,
    createdAt: session.createdAt,
    images: input.images,
  });

  return {
    ...session,
    images,
  };
}

export async function listAppraisalHistory(
  options: ListAppraisalHistoryOptions = {}
): Promise<AppraisalHistoryItem[]> {
  if (!isBlobConfigured()) {
    return [];
  }

  const limit = options.limit ?? DEFAULT_HISTORY_LIMIT;
  const scanLimit = options.appointmentId
    ? Math.max(limit * 10, 200)
    : Math.max(limit * 3, limit);

  const page = await list({
    prefix: getHistoryRecordPrefix(),
    limit: scanLimit,
  });

  const recordBlobs = [...page.blobs]
    .sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime())
    .slice(0, scanLimit);

  const items = await Promise.all(recordBlobs.map((blob) => fetchHistoryRecord(blob.url)));

  return items
    .filter((item): item is AppraisalHistoryItem => item !== null)
    .filter((item) => (options.itemId ? item.id === options.itemId : true))
    .filter((item) =>
      options.appointmentId ? item.appointmentId === options.appointmentId : true
    )
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )
    .slice(0, limit);
}

export async function updateAppraisalHistoryItemInBlob(
  input: UpdateAppraisalHistoryItemInput
): Promise<AppraisalHistoryItem | null> {
  if (!isBlobConfigured()) {
    return null;
  }

  const item = await findHistoryRecordById(input.itemId);

  if (!item) {
    return null;
  }

  const nextItem: AppraisalHistoryItem = {
    ...item,
    manualMaxPrice:
      "manualMaxPrice" in input ? input.manualMaxPrice ?? null : item.manualMaxPrice,
    offerPrice: "offerPrice" in input ? input.offerPrice ?? null : item.offerPrice,
    contractPrice:
      "offerPrice" in input
        ? input.offerPrice ?? null
        : "contractPrice" in input
          ? input.contractPrice ?? null
          : item.contractPrice,
    isExcluded:
      "isExcluded" in input && typeof input.isExcluded === "boolean"
        ? input.isExcluded
        : item.isExcluded,
    isContracted:
      "isContracted" in input && typeof input.isContracted === "boolean"
        ? input.isContracted
        : item.isContracted,
  };

  await putHistoryRecord(nextItem);

  return nextItem;
}

export async function renameAppointmentInBlob(
  appointmentId: string,
  appointmentLabel: string
): Promise<RenameAppointmentResult> {
  if (!isBlobConfigured()) {
    return {
      appointmentId,
      appointmentLabel,
      updatedCount: 0,
    };
  }

  const page = await list({
    prefix: getHistoryRecordPrefix(),
    limit: 500,
  });

  const recordBlobs = [...page.blobs].sort(
    (a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime()
  );

  let updatedCount = 0;

  for (const blob of recordBlobs) {
    const item = await fetchHistoryRecord(blob.url);
    if (!item || item.appointmentId !== appointmentId) {
      continue;
    }

    const nextItem: AppraisalHistoryItem = {
      ...item,
      appointmentLabel,
    };

    await put(getHistoryRecordPathname(nextItem), JSON.stringify(nextItem, null, 2), {
      access: "public",
      addRandomSuffix: false,
      contentType: "application/json; charset=utf-8",
      cacheControlMaxAge: 60,
    });
    updatedCount += 1;
  }

  return {
    appointmentId,
    appointmentLabel,
    updatedCount,
  };
}

export function isHistoryStorageEnabled(): boolean {
  return isBlobConfigured();
}
