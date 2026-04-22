import {
  createAppraisalHistorySessionInBlob,
  isHistoryStorageEnabled as isBlobHistoryStorageEnabled,
  listAppraisalHistory as listBlobHistory,
  renameAppointmentInBlob,
  saveAppraisalHistoryImagesInBlob,
  saveAppraisalHistory as saveBlobHistory,
  updateAppraisalHistoryItemInBlob,
} from "@/lib/history/blob";
import {
  createAppraisalHistorySessionInSupabase,
  isSupabaseHistoryStorageEnabled,
  listAppraisalHistoryFromSupabase,
  renameAppointmentInSupabase,
  saveAppraisalHistoryImagesToSupabase,
  saveAppraisalHistoryToSupabase,
  updateAppraisalHistoryItemInSupabase,
} from "@/lib/history/supabase";
import {
  ListAppraisalHistoryOptions,
  SaveAppraisalHistoryImagesInput,
  SaveAppraisalHistoryInput,
  SaveAppraisalHistorySessionInput,
  UpdateAppraisalHistoryItemInput,
} from "@/lib/history/shared";

export async function saveAppraisalHistory(input: SaveAppraisalHistoryInput) {
  if (isSupabaseHistoryStorageEnabled()) {
    return saveAppraisalHistoryToSupabase(input);
  }

  return saveBlobHistory(input);
}

export async function createAppraisalHistorySession(
  input: SaveAppraisalHistorySessionInput
) {
  if (isSupabaseHistoryStorageEnabled()) {
    return createAppraisalHistorySessionInSupabase(input);
  }

  return createAppraisalHistorySessionInBlob(input);
}

export async function saveAppraisalHistoryImages(
  input: SaveAppraisalHistoryImagesInput
) {
  if (isSupabaseHistoryStorageEnabled()) {
    return saveAppraisalHistoryImagesToSupabase(input);
  }

  return saveAppraisalHistoryImagesInBlob(input);
}

export async function listAppraisalHistory(options?: ListAppraisalHistoryOptions) {
  if (isSupabaseHistoryStorageEnabled()) {
    return listAppraisalHistoryFromSupabase(options);
  }

  return listBlobHistory(options);
}

export async function renameAppointment(
  appointmentId: string,
  appointmentLabel: string
) {
  if (isSupabaseHistoryStorageEnabled()) {
    return renameAppointmentInSupabase(appointmentId, appointmentLabel);
  }

  return renameAppointmentInBlob(appointmentId, appointmentLabel);
}

export async function updateAppraisalHistoryItem(
  input: UpdateAppraisalHistoryItemInput
) {
  if (isSupabaseHistoryStorageEnabled()) {
    return updateAppraisalHistoryItemInSupabase(input);
  }

  return updateAppraisalHistoryItemInBlob(input);
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
