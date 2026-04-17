import { NextResponse } from "next/server";
import {
  getHistoryBackendName,
  isHistoryStorageEnabled,
  listAppraisalHistory,
} from "@/lib/history";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const items = await listAppraisalHistory();

    return NextResponse.json({
      enabled: isHistoryStorageEnabled(),
      backend: getHistoryBackendName(),
      items,
    });
  } catch (error) {
    console.error("History listing error:", error);
    return NextResponse.json(
      {
        error: "査定履歴の取得に失敗しました。",
      },
      { status: 500 }
    );
  }
}
