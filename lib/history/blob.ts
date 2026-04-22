import { list, put } from "@vercel/blob";
import { AppraisalHistoryImage, AppraisalHistoryItem } from "@/lib/appraisal/types";
import {
  DEFAULT_HISTORY_LIMIT,
  ListAppraisalHistoryOptions,
  RenameAppointmentResult,
  getExtension,
  mapPricing,
  SaveAppraisalHistoryInput,
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
  return isAppraisalHistoryItem(payload) ? payload : null;
}

export async function saveAppraisalHistory(
  input: SaveAppraisalHistoryInput
): Promise<AppraisalHistoryItem | null> {
  if (!isBlobConfigured()) {
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
    appointmentId: input.appointmentId || null,
    appointmentLabel: input.appointmentLabel || null,
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
    .filter((item) =>
      options.appointmentId ? item.appointmentId === options.appointmentId : true
    )
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )
    .slice(0, limit);
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
