import {
  isHistoryStorageEnabled as isBlobHistoryStorageEnabled,
  listAppraisalHistory as listBlobHistory,
  renameAppointmentInBlob,
  saveAppraisalHistory as saveBlobHistory,
} from "@/lib/history/blob";
import {
  isSupabaseHistoryStorageEnabled,
  listAppraisalHistoryFromSupabase,
  renameAppointmentInSupabase,
  saveAppraisalHistoryToSupabase,
} from "@/lib/history/supabase";
import {
  ListAppraisalHistoryOptions,
  SaveAppraisalHistoryInput,
} from "@/lib/history/shared";

export async function saveAppraisalHistory(input: SaveAppraisalHistoryInput) {
  if (isSupabaseHistoryStorageEnabled()) {
    return saveAppraisalHistoryToSupabase(input);
  }

  return saveBlobHistory(input);
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
