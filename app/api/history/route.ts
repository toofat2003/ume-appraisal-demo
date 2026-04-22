import { NextResponse } from "next/server";
import {
  getHistoryBackendName,
  isHistoryStorageEnabled,
  listAppraisalHistory,
  renameAppointment,
  saveAppraisalHistory,
  updateAppraisalHistoryItem,
} from "@/lib/history";
import { APPOINTMENT_HISTORY_LIMIT, DEFAULT_HISTORY_LIMIT } from "@/lib/history/shared";
import { groupHistoryItems } from "@/lib/appointments/shared";
import {
  getClientSessionIdFromRequest,
  getUserAgentFromRequest,
  logErrorEvent,
} from "@/lib/observability/server";
import type { AppraisalConditionRank } from "@/lib/appraisal/types";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const appointmentId = searchParams.get("appointmentId")?.trim() || null;
    const itemId = searchParams.get("itemId")?.trim() || null;
    const requestedLimit = Number(searchParams.get("limit") || "");
    const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
      ? Math.min(
          Math.floor(requestedLimit),
          appointmentId || itemId ? APPOINTMENT_HISTORY_LIMIT : DEFAULT_HISTORY_LIMIT
        )
      : appointmentId || itemId
        ? APPOINTMENT_HISTORY_LIMIT
        : DEFAULT_HISTORY_LIMIT;
    const items = await listAppraisalHistory({
      appointmentId,
      itemId,
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
      itemId?: unknown;
      manualMaxPrice?: unknown;
      conditionRank?: unknown;
      offerPrice?: unknown;
      contractPrice?: unknown;
      isExcluded?: unknown;
      isContracted?: unknown;
    };
    const itemId = typeof payload.itemId === "string" ? payload.itemId.trim() : "";

    if (itemId) {
      const normalizePrice = (
        value: unknown
      ): { value: number | null | undefined; error: string | null } => {
        if (value === undefined) {
          return { value: undefined, error: null };
        }
        if (value === null || value === "") {
          return { value: null, error: null };
        }
        const numericValue = Number(value);
        if (!Number.isFinite(numericValue) || numericValue < 0) {
          return { value: undefined, error: "価格は0以上の数値で入力してください。" };
        }
        return { value: Math.round(numericValue), error: null };
      };
      const manualMaxPrice = normalizePrice(payload.manualMaxPrice);
      const offerPrice = normalizePrice(payload.offerPrice);
      const contractPrice = normalizePrice(payload.contractPrice);
      const normalizeConditionRank = (
        value: unknown
      ): { value: AppraisalConditionRank | null | undefined; error: string | null } => {
        if (value === undefined) {
          return { value: undefined, error: null };
        }
        if (value === null || value === "") {
          return { value: null, error: null };
        }
        if (value === "A" || value === "B" || value === "C") {
          return { value, error: null };
        }
        return { value: undefined, error: "状態ランクはA/B/Cから選択してください。" };
      };
      const conditionRank = normalizeConditionRank(payload.conditionRank);

      if (
        manualMaxPrice.error ||
        offerPrice.error ||
        contractPrice.error ||
        conditionRank.error
      ) {
        return NextResponse.json(
          {
            error:
              manualMaxPrice.error ||
              offerPrice.error ||
              contractPrice.error ||
              conditionRank.error,
          },
          { status: 400 }
        );
      }

      const updateInput: {
        itemId: string;
        manualMaxPrice?: number | null;
        conditionRank?: AppraisalConditionRank | null;
        offerPrice?: number | null;
        contractPrice?: number | null;
        isExcluded?: boolean;
        isContracted?: boolean;
      } = { itemId };

      if (manualMaxPrice.value !== undefined) {
        updateInput.manualMaxPrice = manualMaxPrice.value;
      }

      if (conditionRank.value !== undefined) {
        updateInput.conditionRank = conditionRank.value;
      }

      if (offerPrice.value !== undefined) {
        updateInput.offerPrice = offerPrice.value;
      }

      if (contractPrice.value !== undefined) {
        updateInput.contractPrice = contractPrice.value;
      }

      if (typeof payload.isExcluded === "boolean") {
        updateInput.isExcluded = payload.isExcluded;
      }

      if (typeof payload.isContracted === "boolean") {
        updateInput.isContracted = payload.isContracted;
      }

      const updatedItem = await updateAppraisalHistoryItem(updateInput);

      if (!updatedItem) {
        return NextResponse.json(
          {
            error: "対象の査定履歴が見つかりません。",
          },
          { status: 404 }
        );
      }

      return NextResponse.json({
        item: updatedItem,
      });
    }

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
    console.error("History patch error:", error);
    const errorId = await logErrorEvent({
      requestId,
      source: "api.history.patch",
      route: "/api/history",
      message:
        error instanceof Error ? error.message : "査定履歴更新中に予期しないエラーが発生しました。",
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
        error: "査定履歴の更新に失敗しました。",
        errorId,
      },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();

  try {
    const payload = (await request.json()) as {
      itemName?: unknown;
      priceUsd?: unknown;
      appointmentId?: unknown;
      appointmentLabel?: unknown;
    };
    const itemName =
      typeof payload.itemName === "string" ? payload.itemName.trim().slice(0, 180) : "";
    const priceUsd = Number(payload.priceUsd);
    const appointmentId =
      typeof payload.appointmentId === "string" ? payload.appointmentId.trim() : "";
    const appointmentLabel =
      typeof payload.appointmentLabel === "string"
        ? payload.appointmentLabel.trim().slice(0, 120)
        : "";

    if (!itemName) {
      return NextResponse.json(
        {
          error: "品目名を入力してください。",
        },
        { status: 400 }
      );
    }

    if (!Number.isFinite(priceUsd) || priceUsd <= 0) {
      return NextResponse.json(
        {
          error: "価格は1ドル以上の数値で入力してください。",
        },
        { status: 400 }
      );
    }

    const roundedPrice = Math.round(priceUsd);
    const savedItem = await saveAppraisalHistory({
      images: [],
      appointmentId: appointmentId || null,
      appointmentLabel: appointmentLabel || null,
      identification: {
        itemName,
        brand: "",
        model: "",
        category: "手動入力",
        categoryGroup: "other",
        conditionSummary: "手動入力",
        confidence: 1,
        searchQuery: itemName,
        reasoning: "自動査定を使わず、現場で品目と価格を手動入力したレコードです。",
      },
      pricing: {
        suggestedMaxPrice: roundedPrice,
        buyPriceRangeLow: roundedPrice,
        buyPriceRangeHigh: roundedPrice,
        low: roundedPrice,
        median: roundedPrice,
        high: roundedPrice,
        listingCount: 0,
        categoryRatio: 1,
        confidenceAdjustment: 1,
        formula: "手動入力価格をそのまま保存",
      },
      rawResult: {
        entrySource: "manual",
        itemName,
        priceUsd: roundedPrice,
      },
    });

    if (!savedItem) {
      return NextResponse.json(
        {
          error: "履歴保存ストレージが未設定のため、手動入力を保存できません。",
        },
        { status: 503 }
      );
    }

    return NextResponse.json({
      item: savedItem,
    });
  } catch (error) {
    console.error("Manual history save error:", error);
    const errorId = await logErrorEvent({
      requestId,
      source: "api.history.manual",
      route: "/api/history",
      message:
        error instanceof Error ? error.message : "手動入力の保存中に予期しないエラーが発生しました。",
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
        error: "手動入力の保存に失敗しました。",
        errorId,
      },
      { status: 500 }
    );
  }
}
