import { NextResponse } from "next/server";
import {
  getHistoryBackendName,
  isHistoryStorageEnabled,
  listAppraisalHistory,
  renameAppointment,
} from "@/lib/history";
import { APPOINTMENT_HISTORY_LIMIT, DEFAULT_HISTORY_LIMIT } from "@/lib/history/shared";
import { groupHistoryItems } from "@/lib/appointments/shared";
import {
  getClientSessionIdFromRequest,
  getUserAgentFromRequest,
  logErrorEvent,
} from "@/lib/observability/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const appointmentId = searchParams.get("appointmentId")?.trim() || null;
    const requestedLimit = Number(searchParams.get("limit") || "");
    const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
      ? Math.min(
          Math.floor(requestedLimit),
          appointmentId ? APPOINTMENT_HISTORY_LIMIT : DEFAULT_HISTORY_LIMIT
        )
      : appointmentId
        ? APPOINTMENT_HISTORY_LIMIT
        : DEFAULT_HISTORY_LIMIT;
    const items = await listAppraisalHistory({
      appointmentId,
      limit,
    });
    const appointment =
      appointmentId && items.length > 0
        ? groupHistoryItems(items).find((group) => group.appointmentId === appointmentId) || null
        : null;

    return NextResponse.json({
      enabled: isHistoryStorageEnabled(),
      backend: getHistoryBackendName(),
      appointment,
      items,
    });
  } catch (error) {
    console.error("History listing error:", error);
    const errorId = await logErrorEvent({
      requestId: crypto.randomUUID(),
      source: "api.history",
      route: "/api/history",
      message:
        error instanceof Error ? error.message : "査定履歴の取得中に予期しないエラーが発生しました。",
      errorName: error instanceof Error ? error.name : null,
      stack: error instanceof Error ? error.stack : null,
      metadata: {
        backend: getHistoryBackendName(),
      },
      userAgent: getUserAgentFromRequest(request),
      clientSessionId: getClientSessionIdFromRequest(request),
      url: request.url,
    });
    return NextResponse.json(
      {
        error: "査定履歴の取得に失敗しました。",
        errorId,
      },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
  const requestId = crypto.randomUUID();

  try {
    const payload = (await request.json()) as {
      appointmentId?: unknown;
      appointmentLabel?: unknown;
    };
    const appointmentId =
      typeof payload.appointmentId === "string" ? payload.appointmentId.trim() : "";
    const appointmentLabel =
      typeof payload.appointmentLabel === "string"
        ? payload.appointmentLabel.trim()
        : "";

    if (!appointmentId) {
      return NextResponse.json(
        {
          error: "appointmentId が必要です。",
        },
        { status: 400 }
      );
    }

    if (!appointmentLabel) {
      return NextResponse.json(
        {
          error: "アポ名を入力してください。",
        },
        { status: 400 }
      );
    }

    const result = await renameAppointment(appointmentId, appointmentLabel.slice(0, 120));

    return NextResponse.json(result);
  } catch (error) {
    console.error("Appointment rename error:", error);
    const errorId = await logErrorEvent({
      requestId,
      source: "api.history.rename",
      route: "/api/history",
      message:
        error instanceof Error ? error.message : "アポ名変更中に予期しないエラーが発生しました。",
      errorName: error instanceof Error ? error.name : null,
      stack: error instanceof Error ? error.stack : null,
      metadata: {
        backend: getHistoryBackendName(),
      },
      userAgent: getUserAgentFromRequest(request),
      clientSessionId: getClientSessionIdFromRequest(request),
      url: request.url,
    });
    return NextResponse.json(
      {
        error: "アポ名の変更に失敗しました。",
        errorId,
      },
      { status: 500 }
    );
  }
}
