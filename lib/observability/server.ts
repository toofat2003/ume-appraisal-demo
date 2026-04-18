import { createClient, SupabaseClient } from "@supabase/supabase-js";

type ErrorSeverity = "error" | "warning";

type LogErrorEventInput = {
  requestId?: string | null;
  source: string;
  route: string;
  message: string;
  severity?: ErrorSeverity;
  errorName?: string | null;
  stack?: string | null;
  metadata?: Record<string, unknown> | null;
  userAgent?: string | null;
  clientSessionId?: string | null;
  url?: string | null;
};

let adminClient: SupabaseClient | null = null;

function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

function getClient(): SupabaseClient | null {
  if (!isSupabaseConfigured()) {
    return null;
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

function truncate(value: string | null | undefined, maxLength: number): string | null {
  if (!value) {
    return null;
  }

  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}

export async function logErrorEvent(input: LogErrorEventInput): Promise<string> {
  const eventId = crypto.randomUUID();
  const payload = {
    id: eventId,
    request_id: input.requestId ?? null,
    severity: input.severity ?? "error",
    source: truncate(input.source, 80) || "unknown",
    route: truncate(input.route, 200) || "unknown",
    message: truncate(input.message, 4000) || "unknown error",
    error_name: truncate(input.errorName, 200) || "",
    stack: truncate(input.stack, 12000),
    user_agent: truncate(input.userAgent, 1000),
    client_session_id: truncate(input.clientSessionId, 200),
    url: truncate(input.url, 1000),
    metadata: {
      ...(input.metadata || {}),
      vercelEnv: process.env.VERCEL_ENV || process.env.NODE_ENV || "unknown",
      commitSha: process.env.VERCEL_GIT_COMMIT_SHA || null,
    },
  };

  try {
    const client = getClient();
    if (!client) {
      console.error("Error event without Supabase configuration:", payload);
      return eventId;
    }

    const { error } = await client.from("app_error_events").insert(payload);

    if (error) {
      console.error("Failed to store error event:", error, payload);
    }
  } catch (loggingError) {
    console.error("Unexpected error while storing error event:", loggingError, payload);
  }

  return eventId;
}

export function getClientSessionIdFromRequest(request: Request): string | null {
  return request.headers.get("x-client-session-id");
}

export function getUserAgentFromRequest(request: Request): string | null {
  return request.headers.get("user-agent");
}
