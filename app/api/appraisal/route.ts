import { after, NextResponse } from "next/server";
import { searchListingsByImage } from "@/lib/appraisal/ebay";
import { AppraisalDebug, AppraisalResult, ListingSummary } from "@/lib/appraisal/types";
import {
  createAppraisalHistorySession,
  saveAppraisalHistoryImages,
} from "@/lib/history";
import {
  getClientSessionIdFromRequest,
  getUserAgentFromRequest,
  logErrorEvent,
} from "@/lib/observability/server";

const MAX_IMAGE_COUNT = 3;
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;
const DEFAULT_SLOT_LABELS = ["全体", "識別情報", "状態情報"] as const;
const MAX_APPOINTMENT_LABEL_LENGTH = 120;

function roundCurrency(value: number): number {
  return Math.round(value);
}

function quantile(values: number[], q: number): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * q;
  const base = Math.floor(position);
  const remainder = position - base;
  const lower = sorted[base];
  const upper = sorted[Math.min(base + 1, sorted.length - 1)];
  return lower + (upper - lower) * remainder;
}

function getCategoryRatio(categoryGroup: string): number {
  switch (categoryGroup) {
    case "luxury":
    case "watch":
    case "jewelry":
      return 0.6;
    case "electronics":
    case "tools":
      return 0.55;
    case "fashion":
      return 0.5;
    case "media":
    case "collectible":
      return 0.45;
    case "home":
    case "appliance":
      return 0.4;
    default:
      return 0.45;
  }
}

function getConfidenceAdjustment(confidence: number): number {
  if (confidence >= 0.9) {
    return 1;
  }
  if (confidence >= 0.75) {
    return 0.95;
  }
  if (confidence >= 0.6) {
    return 0.9;
  }
  return 0.8;
}

function buildWarnings(
  listings: ListingSummary[],
  confidence: number,
  accessoryFilteredCount: number,
  debug: AppraisalDebug
): string[] {
  const warnings: string[] = [];

  if (listings.length < 4) {
    warnings.push("類似出品件数が少ないため、あくまで概算として扱ってください。");
  }

  if (confidence < 0.7) {
    warnings.push("商品特定の確信度が 0.70 未満です。目視での確認を推奨します。");
  }

  if (listings.some((listing) => !listing.condition.toLowerCase().includes("used"))) {
    warnings.push("新品系の出品が混ざっている可能性があり、Max価格がやや強気になっている恐れがあります。");
  }

  if (accessoryFilteredCount > 0) {
    warnings.push(
      `付属品単体と判断した出品を ${accessoryFilteredCount} 件、価格計算から除外しました。`
    );
  }

  if (debug.selectedImageIndex !== null && debug.selectedImageIndex > 0) {
    warnings.push(
      `${debug.selectedImageIndex + 1}枚目の画像のほうが商品特定に使いやすかったため、1枚目ではなくそちらを主に参照しています。`
    );
  }

  if (debug.queryStage && debug.queryStage.filteredListingCount < 3) {
    warnings.push(
      "品名からのeBay検索で十分な一致件数を取れず、価格参照がブレやすい状態です。"
    );
  }

  const failedImages = [
    ...debug.imageStages.filter((stage) => stage.errorMessage),
    ...(debug.visionStages || []).filter((stage) => stage.errorMessage),
    ...(debug.geminiStage?.errorMessage ? [debug.geminiStage] : []),
  ];
  if (failedImages.length > 0) {
    warnings.push(
      `画像解析の一部で ${failedImages.length} 件のエラーがありました。成功した解析結果だけで査定しています。`
    );
  }

  return warnings;
}

async function fileToBase64(file: File): Promise<{ contentType: string; data: string }> {
  const arrayBuffer = await file.arrayBuffer();
  return {
    contentType: file.type || "image/jpeg",
    data: Buffer.from(arrayBuffer).toString("base64"),
  };
}

function getImageAnalysisErrors(debug: AppraisalDebug): string[] {
  return Array.from(
    new Set(
      [
        ...debug.imageStages.map((stage) => stage.errorMessage),
        ...(debug.visionStages || []).map((stage) => stage.errorMessage),
        debug.geminiStage?.errorMessage,
      ].filter((message): message is string => Boolean(message))
    )
  );
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  let files: File[] = [];
  let slotLabels: string[] = [];
  let appointmentId: string | null = null;
  let appointmentLabel: string | null = null;

  try {
    const formData = await request.formData();
    files = formData
      .getAll("images")
      .filter((entry): entry is File => entry instanceof File && entry.size > 0)
      .slice(0, MAX_IMAGE_COUNT);
    slotLabels = formData
      .getAll("imageSlotLabels")
      .filter((entry): entry is string => typeof entry === "string")
      .slice(0, MAX_IMAGE_COUNT);
    appointmentId =
      typeof formData.get("appointmentId") === "string"
        ? ((formData.get("appointmentId") as string).trim() || null)
        : null;
    appointmentLabel =
      typeof formData.get("appointmentLabel") === "string"
        ? ((formData.get("appointmentLabel") as string).trim() || null)
        : null;

    if (appointmentLabel && appointmentLabel.length > MAX_APPOINTMENT_LABEL_LENGTH) {
      appointmentLabel = appointmentLabel.slice(0, MAX_APPOINTMENT_LABEL_LENGTH);
    }

    if (files.length === 0) {
      return NextResponse.json({ error: "少なくとも1枚の画像が必要です。" }, { status: 400 });
    }

    for (const file of files) {
      if (file.size > MAX_FILE_SIZE_BYTES) {
        return NextResponse.json(
          { error: `画像は1枚あたり5MB以下にしてください: ${file.name}` },
          { status: 400 }
        );
      }
    }

    const images = await Promise.all(files.map((file) => fileToBase64(file)));
    const { identification, listings, accessoryFilteredCount, debug } = await searchListingsByImage(
      images
    );
    const requestMetadata = {
      imageCount: files.length,
      imageNames: files.map((file) => file.name),
      imageTypes: files.map((file) => file.type || "unknown"),
      imageSizes: files.map((file) => file.size),
      imageSlotLabels: slotLabels,
      appointmentId,
      appointmentLabel,
    };

    if (listings.length === 0) {
      const failedImageMessages = getImageAnalysisErrors(debug);

      const errorId =
        failedImageMessages.length > 0
          ? await logErrorEvent({
              requestId,
              source: "api.appraisal",
              route: "/api/appraisal",
              severity: "warning",
              message: "All uploaded images failed before a valid appraisal result was produced.",
              metadata: {
                ...requestMetadata,
                failedImageMessages,
                debug,
              },
              userAgent: getUserAgentFromRequest(request),
              clientSessionId: getClientSessionIdFromRequest(request),
              url: request.url,
            })
          : null;

      return NextResponse.json(
        {
          error:
            failedImageMessages[0] ||
            "画像から十分な商品候補または価格参照を取得できませんでした。全体写真をより正面から撮るか、ロゴ・型番・刻印が読める写真を追加して再試行してください。",
          identification,
          errorId,
        },
        { status: failedImageMessages.length > 0 ? 422 : 404 }
      );
    }

    const totalPrices = listings.map((listing) => listing.totalPrice.amount);
    const p25 = quantile(totalPrices, 0.25);
    const median = quantile(totalPrices, 0.5);
    const p75 = quantile(totalPrices, 0.75);
    const ratio = getCategoryRatio(identification.categoryGroup);
    const confidenceAdjustment = getConfidenceAdjustment(identification.confidence);
    const suggestedMaxPrice = roundCurrency(p25 * ratio * confidenceAdjustment);
    const buyPriceRangeLow = roundCurrency(suggestedMaxPrice * 0.8);
    const buyPriceRangeHigh = suggestedMaxPrice;

    const result: AppraisalResult = {
      identification,
      pricing: {
        listingCount: listings.length,
        low: roundCurrency(p25),
        median: roundCurrency(median),
        high: roundCurrency(p75),
        suggestedMaxPrice,
        buyPriceRangeLow,
        buyPriceRangeHigh,
        categoryRatio: ratio,
        confidenceAdjustment,
        formula: "出品総額のp25 × カテゴリ係数 × 確信度補正",
      },
      listings: listings.slice(0, 8),
      warnings: buildWarnings(listings, identification.confidence, accessoryFilteredCount, debug),
      debug,
    };

    const failedImageStages = [
      ...debug.imageStages.filter((stage) => stage.errorMessage),
      ...(debug.visionStages || []).filter((stage) => stage.errorMessage),
      ...(debug.geminiStage?.errorMessage ? [debug.geminiStage] : []),
    ];
    if (failedImageStages.length > 0) {
      await logErrorEvent({
        requestId,
        source: "api.appraisal",
        route: "/api/appraisal",
        severity: "warning",
        message: "Partial image analysis failure during appraisal request.",
        metadata: {
          ...requestMetadata,
          failedImageStages,
          selectedImageIndex: debug.selectedImageIndex,
        },
        userAgent: getUserAgentFromRequest(request),
        clientSessionId: getClientSessionIdFromRequest(request),
        url: request.url,
      });
    }

    const historyImages = files.map((file, index) => ({
      file,
      slotLabel: slotLabels[index] || DEFAULT_SLOT_LABELS[index] || `写真${index + 1}`,
    }));
    const historyRawResult = {
      identification: result.identification,
      pricing: result.pricing,
      listings: result.listings,
      warnings: result.warnings,
      debug: result.debug,
    };

    try {
      const savedHistory = await createAppraisalHistorySession({
        identification: result.identification,
        pricing: result.pricing,
        appointmentId,
        appointmentLabel,
        rawResult: historyRawResult,
      });

      result.savedHistoryId = savedHistory?.id ?? null;
      result.savedHistoryAt = savedHistory?.createdAt ?? null;
      result.savedHistoryItem = savedHistory;

      if (savedHistory && historyImages.length > 0) {
        const userAgent = getUserAgentFromRequest(request);
        const clientSessionId = getClientSessionIdFromRequest(request);
        const requestUrl = request.url;
        const sessionId = savedHistory.id;
        const createdAt = savedHistory.createdAt;

        after(async () => {
          try {
            await saveAppraisalHistoryImages({
              sessionId,
              createdAt,
              images: historyImages,
            });
          } catch (historyImageError) {
            console.error("History image save error:", historyImageError);
            await logErrorEvent({
              requestId,
              source: "api.appraisal.history-image-save",
              route: "/api/appraisal",
              message:
                historyImageError instanceof Error
                  ? historyImageError.message
                  : "査定履歴の画像保存に失敗しました。",
              errorName:
                historyImageError instanceof Error ? historyImageError.name : null,
              stack:
                historyImageError instanceof Error ? historyImageError.stack : null,
              metadata: {
                ...requestMetadata,
                sessionId,
                createdAt,
                imageCount: historyImages.length,
              },
              userAgent,
              clientSessionId,
              url: requestUrl,
            });
          }
        });
      }
    } catch (historyError) {
      console.error("History save error:", historyError);
      const historyErrorId = await logErrorEvent({
        requestId,
        source: "api.appraisal.history-save",
        route: "/api/appraisal",
        message:
          historyError instanceof Error
            ? historyError.message
            : "査定結果の履歴保存に失敗しました。",
        errorName: historyError instanceof Error ? historyError.name : null,
        stack: historyError instanceof Error ? historyError.stack : null,
        metadata: {
          ...requestMetadata,
          identification: result.identification,
          pricing: result.pricing,
        },
        userAgent: getUserAgentFromRequest(request),
        clientSessionId: getClientSessionIdFromRequest(request),
        url: request.url,
      });
      result.savedHistoryId = null;
      result.savedHistoryAt = null;
      result.savedHistoryItem = null;
      result.warnings = [
        ...result.warnings,
        `査定結果は表示できていますが、履歴保存には失敗しました。エラーID: ${historyErrorId}`,
      ];
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error("Appraisal demo error:", error);
    const errorId = await logErrorEvent({
      requestId,
      source: "api.appraisal",
      route: "/api/appraisal",
      message:
        error instanceof Error
          ? error.message
          : "査定の生成中に予期しないエラーが発生しました。",
      errorName: error instanceof Error ? error.name : null,
      stack: error instanceof Error ? error.stack : null,
      metadata: {
        imageCount: files.length,
        imageNames: files.map((file) => file.name),
        imageTypes: files.map((file) => file.type || "unknown"),
        imageSizes: files.map((file) => file.size),
        imageSlotLabels: slotLabels,
        appointmentId,
        appointmentLabel,
      },
      userAgent: getUserAgentFromRequest(request),
      clientSessionId: getClientSessionIdFromRequest(request),
      url: request.url,
    });
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "査定の生成中に予期しないエラーが発生しました。",
        errorId,
      },
      { status: 500 }
    );
  }
}
