import { NextResponse } from "next/server";
import {
  getClientSessionIdFromRequest,
  getUserAgentFromRequest,
  logErrorEvent,
} from "@/lib/observability/server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as {
      source?: string;
      message?: string;
      errorName?: string;
      stack?: string;
      url?: string;
      metadata?: Record<string, unknown>;
    };

    if (!payload?.message || !payload?.source) {
      return NextResponse.json(
        { error: "message と source が必要です。" },
        { status: 400 }
      );
    }

    const errorId = await logErrorEvent({
      source: payload.source,
      route: "/api/client-errors",
      message: payload.message,
      errorName: payload.errorName || null,
      stack: payload.stack || null,
      metadata: payload.metadata || null,
      userAgent: getUserAgentFromRequest(request),
      clientSessionId: getClientSessionIdFromRequest(request),
      url: payload.url || null,
    });

    return NextResponse.json({ ok: true, errorId });
  } catch (error) {
    console.error("Client error logging route failed:", error);
    return NextResponse.json(
      { error: "クライアントエラーログの保存に失敗しました。" },
      { status: 500 }
    );
  }
}
