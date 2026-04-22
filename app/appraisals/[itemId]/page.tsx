"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { FormEvent, useEffect, useRef, useState } from "react";
import styles from "./page.module.css";
import type { AppraisalConditionRank, AppraisalHistoryItem } from "@/lib/appraisal/types";
import {
  getConditionRankLabel,
  getEffectiveMaxPrice,
} from "@/lib/appointments/shared";
import {
  getOrCreateClientSessionId,
  reportClientError,
} from "@/lib/observability/client";

function formatCurrency(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) {
    return "-";
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function inputValueFromPrice(value: number | null): string {
  return value === null ? "" : String(value);
}

export default function AppraisalDetailPage() {
  const params = useParams<{ itemId: string }>();
  const itemId = decodeURIComponent(params.itemId);
  const [item, setItem] = useState<AppraisalHistoryItem | null>(null);
  const [manualMaxPriceInput, setManualMaxPriceInput] = useState("");
  const [offerPriceInput, setOfferPriceInput] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isSavingMaxPrice, setIsSavingMaxPrice] = useState(false);
  const [isTogglingExcluded, setIsTogglingExcluded] = useState(false);
  const [isTogglingContracted, setIsTogglingContracted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorReference, setErrorReference] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const clientSessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    clientSessionIdRef.current = getOrCreateClientSessionId();
    void loadItem();
  }, [itemId]);

  async function loadItem() {
    try {
      setIsLoading(true);
      setError(null);
      setErrorReference(null);
      const clientSessionId =
        clientSessionIdRef.current || getOrCreateClientSessionId();
      clientSessionIdRef.current = clientSessionId;
      const response = await fetch(
        `/api/history?itemId=${encodeURIComponent(itemId)}&limit=1`,
        {
          cache: "no-store",
          headers: clientSessionId
            ? { "x-client-session-id": clientSessionId }
            : undefined,
        }
      );
      const payload = await response.json();

      if (!response.ok) {
        if (typeof payload.errorId === "string") {
          setErrorReference(payload.errorId);
        }
        throw new Error(payload.error || "査定結果の取得に失敗しました");
      }

      const nextItem = Array.isArray(payload.items)
        ? (payload.items[0] as AppraisalHistoryItem | undefined)
        : undefined;

      if (!nextItem) {
        throw new Error("対象の査定結果が見つかりません");
      }

      setItem(nextItem);
      setManualMaxPriceInput(inputValueFromPrice(nextItem.manualMaxPrice));
      setOfferPriceInput(inputValueFromPrice(nextItem.offerPrice));
    } catch (err) {
      if (err instanceof Error) {
        void reportClientError({
          source: "appraisal.detail.load",
          message: err.message,
          errorName: err.name,
          stack: err.stack || null,
          metadata: {
            itemId,
          },
        });
      }
      setError(err instanceof Error ? err.message : "査定結果の取得に失敗しました");
    } finally {
      setIsLoading(false);
    }
  }

  async function patchItem(payload: {
    manualMaxPrice?: number | null;
    conditionRank?: AppraisalConditionRank | null;
    offerPrice?: number | null;
    isExcluded?: boolean;
    isContracted?: boolean;
  }): Promise<AppraisalHistoryItem> {
    const clientSessionId =
      clientSessionIdRef.current || getOrCreateClientSessionId();
    clientSessionIdRef.current = clientSessionId;
    const response = await fetch("/api/history", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        ...(clientSessionId ? { "x-client-session-id": clientSessionId } : {}),
      },
      body: JSON.stringify({
        itemId,
        ...payload,
      }),
    });
    const responsePayload = await response.json();

    if (!response.ok) {
      if (typeof responsePayload.errorId === "string") {
        setErrorReference(responsePayload.errorId);
      }
      throw new Error(responsePayload.error || "査定結果の更新に失敗しました");
    }

    return responsePayload.item as AppraisalHistoryItem;
  }

  function parsePriceInput(value: string): number | null {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    const numericValue = Number(trimmed);
    if (!Number.isFinite(numericValue) || numericValue < 0) {
      throw new Error("価格は0以上の数値で入力してください");
    }

    return Math.round(numericValue);
  }

  async function handleMaxPriceSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSavingMaxPrice(true);
    setError(null);
    setErrorReference(null);
    setSuccessMessage(null);

    try {
      const nextItem = await patchItem({
        manualMaxPrice: parsePriceInput(manualMaxPriceInput),
        conditionRank: null,
      });
      setItem(nextItem);
      setManualMaxPriceInput(inputValueFromPrice(nextItem.manualMaxPrice));
      setSuccessMessage("Max価格を保存しました。");
    } catch (err) {
      if (err instanceof Error) {
        void reportClientError({
          source: "appraisal.detail.max_price",
          message: err.message,
          errorName: err.name,
          stack: err.stack || null,
          metadata: {
            itemId,
          },
        });
      }
      setError(err instanceof Error ? err.message : "Max価格の保存に失敗しました");
    } finally {
      setIsSavingMaxPrice(false);
    }
  }

  async function handleSettlementSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setError(null);
    setErrorReference(null);
    setSuccessMessage(null);

    try {
      const nextItem = await patchItem({
        offerPrice: parsePriceInput(offerPriceInput),
      });
      setItem(nextItem);
      setOfferPriceInput(inputValueFromPrice(nextItem.offerPrice));
      setSuccessMessage("オファー価格を保存しました。");
    } catch (err) {
      if (err instanceof Error) {
        void reportClientError({
          source: "appraisal.detail.settlement",
          message: err.message,
          errorName: err.name,
          stack: err.stack || null,
          metadata: {
            itemId,
          },
        });
      }
      setError(err instanceof Error ? err.message : "価格の保存に失敗しました");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleToggleContracted() {
    if (!item) {
      return;
    }

    setIsTogglingContracted(true);
    setError(null);
    setErrorReference(null);
    setSuccessMessage(null);

    try {
      const nextItem = await patchItem({
        isContracted: !item.isContracted,
      });
      setItem(nextItem);
      setSuccessMessage(nextItem.isContracted ? "成約済みにしました。" : "未成約に戻しました。");
    } catch (err) {
      if (err instanceof Error) {
        void reportClientError({
          source: "appraisal.detail.contract",
          message: err.message,
          errorName: err.name,
          stack: err.stack || null,
          metadata: {
            itemId,
          },
        });
      }
      setError(err instanceof Error ? err.message : "成約状態の更新に失敗しました");
    } finally {
      setIsTogglingContracted(false);
    }
  }

  async function handleToggleExcluded() {
    if (!item) {
      return;
    }

    setIsTogglingExcluded(true);
    setError(null);
    setErrorReference(null);
    setSuccessMessage(null);

    try {
      const nextItem = await patchItem({
        isExcluded: !item.isExcluded,
      });
      setItem(nextItem);
      setSuccessMessage(nextItem.isExcluded ? "この品物を除外しました。" : "除外を解除しました。");
    } catch (err) {
      if (err instanceof Error) {
        void reportClientError({
          source: "appraisal.detail.exclude",
          message: err.message,
          errorName: err.name,
          stack: err.stack || null,
          metadata: {
            itemId,
          },
        });
      }
      setError(err instanceof Error ? err.message : "除外状態の更新に失敗しました");
    } finally {
      setIsTogglingExcluded(false);
    }
  }

  const backHref = item?.appointmentId
    ? `/appointments/${encodeURIComponent(item.appointmentId)}`
    : "/";
  const effectiveMaxPrice = item ? getEffectiveMaxPrice(item) : null;
  const hasCustomManualMaxPrice =
    item ? item.manualMaxPrice !== null && item.conditionRank === null : false;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link href={backHref} className={styles.backLink}>
          ← アポ詳細に戻る
        </Link>
        <span className={styles.headerTag}>査定結果</span>
      </header>

      <main className={styles.main}>
        {isLoading ? (
          <p className={styles.messageMuted}>読み込んでいます...</p>
        ) : !item ? (
          <section className={styles.messageSection}>
            <p className={styles.messageError}>{error || "査定結果が見つかりません"}</p>
          </section>
        ) : (
          <>
            <section
              className={`${styles.hero} ${item.isExcluded ? styles.excludedHero : ""}`}
            >
              <div>
                <p className={styles.heroLabel}>
                  {item.appointmentLabel || "未分類"} · {formatDateTime(item.createdAt)}
                </p>
                <h1 className={styles.heroTitle}>{item.identification.itemName}</h1>
                <p className={styles.heroCaption}>
                  {item.identification.brand || item.identification.category}
                  {" · "}
                  {item.pricing.listingCount}件参照
                </p>
              </div>
              <div className={styles.heroPriceBlock}>
                <span className={styles.heroPriceLabel}>
                  {item.conditionRank
                    ? `Max価格（${getConditionRankLabel(item.conditionRank)}）`
                    : item.manualMaxPrice === null
                      ? "推奨Max価格"
                      : "Max価格（手動）"}
                </span>
                <span className={styles.heroPrice}>
                  {formatCurrency(effectiveMaxPrice)}
                </span>
                {(item.manualMaxPrice !== null || item.conditionRank !== null) && (
                  <span className={styles.heroPriceNote}>
                    {item.conditionRank
                      ? `市場中央値 ${formatCurrency(item.pricing.median)}`
                      : `査定Max ${formatCurrency(item.pricing.suggestedMaxPrice)}`}
                  </span>
                )}
              </div>
            </section>

            {item.isExcluded && (
              <section className={styles.excludedBanner}>
                この品物はアポ集計から除外されています。
              </section>
            )}

            <section className={styles.imageSection}>
              {item.images.length > 0 ? (
                <div className={styles.imageGrid}>
                  {item.images.map((image) => (
                    <a
                      key={image.pathname}
                      href={image.url}
                      target="_blank"
                      rel="noreferrer"
                      className={styles.imageLink}
                    >
                      <img
                        src={image.url}
                        alt={image.slotLabel}
                        className={`${styles.image} ${
                          item.isExcluded ? styles.excludedImage : ""
                        }`}
                      />
                      <span className={styles.imageBadge}>{image.slotLabel}</span>
                    </a>
                  ))}
                </div>
              ) : (
                <div className={styles.imagePlaceholder}>画像なし</div>
              )}
            </section>

            <section className={styles.maxPriceSection}>
              <div className={styles.sectionHeader}>
                <div>
                  <h2 className={styles.sectionTitle}>Max価格</h2>
                  <p className={styles.sectionCaption}>
                    状態ランクは撮影・査定開始時に選択します。必要に応じて下の手動Max価格で上書きできます。
                  </p>
                </div>
              </div>
              <div className={styles.conditionRankDisplay}>
                <span>査定時ランク</span>
                <strong>
                  {item.conditionRank ? getConditionRankLabel(item.conditionRank) : "未記録"}
                </strong>
                <small>市場価格中央値 {formatCurrency(item.pricing.median)}</small>
              </div>
              {hasCustomManualMaxPrice && (
                <p className={styles.overrideNote}>
                  手動Max価格が優先中です。
                </p>
              )}
              <form className={styles.settlementForm} onSubmit={handleMaxPriceSubmit}>
                <label className={styles.fieldLabel}>
                  手動Max価格 USD
                  <input
                    type="number"
                    min="0"
                    step="1"
                    inputMode="decimal"
                    value={manualMaxPriceInput}
                    onChange={(event) => setManualMaxPriceInput(event.target.value)}
                    className={styles.priceInput}
                    placeholder={`査定Max ${formatCurrency(item.pricing.suggestedMaxPrice)}`}
                  />
                </label>
                <button
                  type="submit"
                  className={styles.saveButton}
                  disabled={isSavingMaxPrice}
                >
                  {isSavingMaxPrice ? "保存中..." : "Max価格を保存"}
                </button>
              </form>
              {item.manualMaxPrice !== null && (
                <p className={styles.overrideNote}>
                  現在は {formatCurrency(item.manualMaxPrice)} を集計に採用しています。
                </p>
              )}
            </section>

            <section className={styles.settlementSection}>
              <div className={styles.sectionHeader}>
                <div>
                  <h2 className={styles.sectionTitle}>オファー価格</h2>
                  <p className={styles.sectionCaption}>
                    現場で提示した金額を保存します。成約時もこの金額を成約金額として扱います。
                  </p>
                </div>
              </div>
              <form className={styles.settlementForm} onSubmit={handleSettlementSubmit}>
                <label className={styles.fieldLabel}>
                  オファー価格 USD
                  <input
                    type="number"
                    min="0"
                    step="1"
                    inputMode="decimal"
                    value={offerPriceInput}
                    onChange={(event) => setOfferPriceInput(event.target.value)}
                    className={styles.priceInput}
                    placeholder="例: 120"
                  />
                </label>
                <button type="submit" className={styles.saveButton} disabled={isSaving}>
                  {isSaving ? "保存中..." : "オファー価格を保存"}
                </button>
              </form>
              <label className={styles.contractCheckboxLabel}>
                <input
                  type="checkbox"
                  checked={item.isContracted}
                  onChange={() => void handleToggleContracted()}
                  disabled={isTogglingContracted}
                />
                <span>{isTogglingContracted ? "更新中..." : "成約済み"}</span>
              </label>
            </section>

            <section className={styles.summarySection}>
              <div className={styles.summaryGrid}>
                <div className={styles.summaryItem}>
                  <span className={styles.summaryLabel}>採用Max価格</span>
                  <span className={styles.summaryValue}>{formatCurrency(effectiveMaxPrice)}</span>
                </div>
                <div className={styles.summaryItem}>
                  <span className={styles.summaryLabel}>査定Max価格</span>
                  <span className={styles.summaryValue}>
                    {formatCurrency(item.pricing.suggestedMaxPrice)}
                  </span>
                </div>
                <div className={styles.summaryItem}>
                  <span className={styles.summaryLabel}>手動Max価格</span>
                  <span className={styles.summaryValue}>{formatCurrency(item.manualMaxPrice)}</span>
                </div>
                <div className={styles.summaryItem}>
                  <span className={styles.summaryLabel}>状態ランク</span>
                  <span className={styles.summaryValue}>
                    {item.conditionRank ? getConditionRankLabel(item.conditionRank) : "未選択"}
                  </span>
                </div>
                <div className={styles.summaryItem}>
                  <span className={styles.summaryLabel}>買取目安</span>
                  <span className={styles.summaryValue}>
                    {formatCurrency(item.pricing.buyPriceRangeLow)}
                    {" - "}
                    {formatCurrency(item.pricing.buyPriceRangeHigh)}
                  </span>
                </div>
                <div className={styles.summaryItem}>
                  <span className={styles.summaryLabel}>オファー価格</span>
                  <span className={styles.summaryValue}>{formatCurrency(item.offerPrice)}</span>
                </div>
                <div className={styles.summaryItem}>
                  <span className={styles.summaryLabel}>成約状態</span>
                  <span className={styles.summaryValue}>
                    {item.isContracted ? "成約済み" : "未成約"}
                  </span>
                </div>
              </div>
            </section>

            <section className={styles.excludeSection}>
              <div>
                <h2 className={styles.sectionTitle}>集計から除外</h2>
                <p className={styles.sectionCaption}>
                  除外すると、アポ詳細の合計価格・件数から外れ、画像がグレーアウトされます。
                </p>
              </div>
              <button
                type="button"
                className={item.isExcluded ? styles.restoreButton : styles.excludeButton}
                onClick={handleToggleExcluded}
                disabled={isTogglingExcluded}
              >
                {isTogglingExcluded
                  ? "更新中..."
                  : item.isExcluded
                    ? "除外を解除"
                    : "この品物を除外"}
              </button>
            </section>

            {successMessage && <p className={styles.messageSuccess}>{successMessage}</p>}
          </>
        )}

        {error && item && (
          <section className={styles.messageSection}>
            <p className={styles.messageError}>{error}</p>
            {errorReference && (
              <p className={styles.messageMeta}>エラーID: {errorReference}</p>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
