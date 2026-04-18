"use client";

const CLIENT_SESSION_STORAGE_KEY = "ume-client-session-id";
const sentErrorSignatures = new Set<string>();
const MAX_CLIENT_ERROR_EVENTS_PER_PAGE = 10;

let sentClientErrorCount = 0;

export type ClientErrorPayload = {
  source: string;
  message: string;
  errorName?: string | null;
  stack?: string | null;
  url?: string | null;
  metadata?: Record<string, unknown>;
};

export function getOrCreateClientSessionId(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const existing = window.localStorage.getItem(CLIENT_SESSION_STORAGE_KEY);
    if (existing) {
      return existing;
    }

    const next = crypto.randomUUID();
    window.localStorage.setItem(CLIENT_SESSION_STORAGE_KEY, next);
    return next;
  } catch {
    return null;
  }
}

export async function reportClientError(payload: ClientErrorPayload): Promise<void> {
  if (typeof window === "undefined") {
    return;
  }

  const signature = JSON.stringify([
    payload.source,
    payload.message,
    payload.errorName || "",
    payload.stack || "",
    payload.url || window.location.href,
  ]);

  if (sentErrorSignatures.has(signature)) {
    return;
  }

  if (sentClientErrorCount >= MAX_CLIENT_ERROR_EVENTS_PER_PAGE) {
    return;
  }

  sentErrorSignatures.add(signature);
  sentClientErrorCount += 1;

  const clientSessionId = getOrCreateClientSessionId();

  try {
    await fetch("/api/client-errors", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(clientSessionId ? { "x-client-session-id": clientSessionId } : {}),
      },
      body: JSON.stringify({
        ...payload,
        url: payload.url || window.location.href,
      }),
      keepalive: true,
    });
  } catch {
    // Best-effort only.
  }
}
