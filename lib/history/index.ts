import {
  isHistoryStorageEnabled as isBlobHistoryStorageEnabled,
  listAppraisalHistory as listBlobHistory,
  saveAppraisalHistory as saveBlobHistory,
} from "@/lib/history/blob";
import {
  isSupabaseHistoryStorageEnabled,
  listAppraisalHistoryFromSupabase,
  saveAppraisalHistoryToSupabase,
} from "@/lib/history/supabase";
import { SaveAppraisalHistoryInput } from "@/lib/history/shared";

export async function saveAppraisalHistory(input: SaveAppraisalHistoryInput) {
  if (isSupabaseHistoryStorageEnabled()) {
    return saveAppraisalHistoryToSupabase(input);
  }

  return saveBlobHistory(input);
}

export async function listAppraisalHistory(limit?: number) {
  if (isSupabaseHistoryStorageEnabled()) {
    return listAppraisalHistoryFromSupabase(limit);
  }

  return listBlobHistory(limit);
}

export function isHistoryStorageEnabled(): boolean {
  return isSupabaseHistoryStorageEnabled() || isBlobHistoryStorageEnabled();
}

export function getHistoryBackendName(): "supabase" | "blob" | "none" {
  if (isSupabaseHistoryStorageEnabled()) {
    return "supabase";
  }

  if (isBlobHistoryStorageEnabled()) {
    return "blob";
  }

  return "none";
}
