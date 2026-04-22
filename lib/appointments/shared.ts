import type { AppraisalAppointmentGroup, AppraisalHistoryItem } from "@/lib/appraisal/types";

export type ActiveAppointment = {
  id: string;
  label: string;
};

export type StoredAppointment = {
  id: string;
  label: string;
  createdAt: string;
  updatedAt: string;
};

export type AppointmentOption = {
  id: string;
  label: string;
  itemCount: number;
  latestAt: string;
  hasSavedItems: boolean;
};

export function groupHistoryItems(items: AppraisalHistoryItem[]): AppraisalAppointmentGroup[] {
  const groups = new Map<string, AppraisalAppointmentGroup>();

  for (const item of items) {
    const groupKey = item.appointmentId || "ungrouped";
    const appointmentLabel = item.appointmentLabel?.trim() || "未分類";
    const existing = groups.get(groupKey);
    const isIncluded = !item.isExcluded;

    if (!existing) {
      groups.set(groupKey, {
        appointmentId: item.appointmentId,
        appointmentLabel,
        latestAppraisalAt: item.createdAt,
        itemCount: isIncluded ? 1 : 0,
        totalItemCount: 1,
        excludedItemCount: isIncluded ? 0 : 1,
        totalSuggestedMaxPrice: isIncluded ? item.pricing.suggestedMaxPrice : 0,
        totalOfferPrice: isIncluded ? item.offerPrice || 0 : 0,
        totalContractPrice: isIncluded ? item.contractPrice || 0 : 0,
        items: [item],
      });
      continue;
    }

    existing.items.push(item);
    existing.totalItemCount += 1;
    if (isIncluded) {
      existing.itemCount += 1;
      existing.totalSuggestedMaxPrice += item.pricing.suggestedMaxPrice;
      existing.totalOfferPrice += item.offerPrice || 0;
      existing.totalContractPrice += item.contractPrice || 0;
    } else {
      existing.excludedItemCount += 1;
    }
    if (
      new Date(item.createdAt).getTime() >
      new Date(existing.latestAppraisalAt).getTime()
    ) {
      existing.latestAppraisalAt = item.createdAt;
    }
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      items: [...group.items].sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      ),
    }))
    .sort(
      (a, b) =>
        new Date(b.latestAppraisalAt).getTime() -
        new Date(a.latestAppraisalAt).getTime()
    );
}

export function upsertStoredAppointment(
  appointments: StoredAppointment[],
  appointment: ActiveAppointment,
  timestamp = new Date().toISOString()
): StoredAppointment[] {
  const next = new Map(appointments.map((item) => [item.id, item]));
  const existing = next.get(appointment.id);

  next.set(appointment.id, {
    id: appointment.id,
    label: appointment.label,
    createdAt: existing?.createdAt || timestamp,
    updatedAt: timestamp,
  });

  return [...next.values()].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
}

export function renameStoredAppointment(
  appointments: StoredAppointment[],
  appointmentId: string,
  appointmentLabel: string,
  timestamp = new Date().toISOString()
): StoredAppointment[] {
  return upsertStoredAppointment(
    appointments,
    {
      id: appointmentId,
      label: appointmentLabel,
    },
    timestamp
  );
}

export function mergeStoredAppointmentsWithHistory(
  appointments: StoredAppointment[],
  historyItems: AppraisalHistoryItem[]
): StoredAppointment[] {
  const next = new Map(appointments.map((item) => [item.id, item]));

  for (const group of groupHistoryItems(historyItems)) {
    if (!group.appointmentId) {
      continue;
    }

    const existing = next.get(group.appointmentId);
    next.set(group.appointmentId, {
      id: group.appointmentId,
      label: group.appointmentLabel,
      createdAt: existing?.createdAt || group.latestAppraisalAt,
      updatedAt: group.latestAppraisalAt,
    });
  }

  return [...next.values()].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
}

export function buildAppointmentOptions(
  appointments: StoredAppointment[],
  appointmentGroups: AppraisalAppointmentGroup[]
): AppointmentOption[] {
  const options = new Map<string, AppointmentOption>();

  for (const appointment of appointments) {
    options.set(appointment.id, {
      id: appointment.id,
      label: appointment.label,
      itemCount: 0,
      latestAt: appointment.updatedAt || appointment.createdAt,
      hasSavedItems: false,
    });
  }

  for (const group of appointmentGroups) {
    if (!group.appointmentId) {
      continue;
    }

    const existing = options.get(group.appointmentId);
    options.set(group.appointmentId, {
      id: group.appointmentId,
      label: existing?.label || group.appointmentLabel,
      itemCount: group.itemCount,
      latestAt: group.latestAppraisalAt,
      hasSavedItems: true,
    });
  }

  return [...options.values()].sort(
    (a, b) => new Date(b.latestAt).getTime() - new Date(a.latestAt).getTime()
  );
}
