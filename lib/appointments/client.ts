import type {
  ActiveAppointment,
  StoredAppointment,
} from "@/lib/appointments/shared";

export const ACTIVE_APPOINTMENT_STORAGE_KEY = "ume-active-appointment";
export const APPOINTMENT_REGISTRY_STORAGE_KEY = "ume-appointment-registry";

function canUseStorage(): boolean {
  return typeof window !== "undefined";
}

export function readStoredAppointment(): ActiveAppointment | null {
  if (!canUseStorage()) {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(ACTIVE_APPOINTMENT_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<ActiveAppointment>;
    if (typeof parsed.id !== "string" || typeof parsed.label !== "string") {
      return null;
    }

    const id = parsed.id.trim();
    const label = parsed.label.trim();

    if (!id || !label) {
      return null;
    }

    return { id, label };
  } catch {
    return null;
  }
}

export function persistActiveAppointment(appointment: ActiveAppointment | null) {
  if (!canUseStorage()) {
    return;
  }

  try {
    if (!appointment) {
      window.localStorage.removeItem(ACTIVE_APPOINTMENT_STORAGE_KEY);
      return;
    }

    window.localStorage.setItem(
      ACTIVE_APPOINTMENT_STORAGE_KEY,
      JSON.stringify(appointment)
    );
  } catch {
    // Ignore localStorage failures.
  }
}

export function readStoredAppointments(): StoredAppointment[] {
  if (!canUseStorage()) {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(APPOINTMENT_REGISTRY_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((entry) => {
        if (!entry || typeof entry !== "object") {
          return null;
        }

        const candidate = entry as Partial<StoredAppointment>;
        if (
          typeof candidate.id !== "string" ||
          typeof candidate.label !== "string" ||
          typeof candidate.createdAt !== "string" ||
          typeof candidate.updatedAt !== "string"
        ) {
          return null;
        }

        const id = candidate.id.trim();
        const label = candidate.label.trim();

        if (!id || !label) {
          return null;
        }

        return {
          id,
          label,
          createdAt: candidate.createdAt,
          updatedAt: candidate.updatedAt,
        };
      })
      .filter((entry): entry is StoredAppointment => entry !== null);
  } catch {
    return [];
  }
}

export function persistStoredAppointments(appointments: StoredAppointment[]) {
  if (!canUseStorage()) {
    return;
  }

  try {
    window.localStorage.setItem(
      APPOINTMENT_REGISTRY_STORAGE_KEY,
      JSON.stringify(appointments)
    );
  } catch {
    // Ignore localStorage failures.
  }
}
