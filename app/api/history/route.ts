import { NextResponse } from "next/server";
import {
  getHistoryBackendName,
  isHistoryStorageEnabled,
  listAppraisalHistory,
} from "@/lib/history";
import {
  getClientSessionIdFromRequest,
  getUserAgentFromRequest,
  logErrorEvent,
} from "@/lib/observability/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const items = await listAppraisalHistory();

    return NextResponse.json({
      enabled: isHistoryStorageEnabled(),
      backend: getHistoryBackendName(),
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
