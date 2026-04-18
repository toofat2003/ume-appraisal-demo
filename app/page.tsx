"use client";

import { ChangeEvent, FormEvent, useEffect, useRef, useState } from "react";
import styles from "./page.module.css";
import type { AppraisalHistoryItem, AppraisalResult } from "@/lib/appraisal/types";
import {
  getOrCreateClientSessionId,
  reportClientError,
} from "@/lib/observability/client";

type PreviewState = {
  file: File | null;
  url: string | null;
};

const EMPTY_SLOT: PreviewState = { file: null, url: null };

const PHOTO_SLOTS = [
  {
    id: "overview",
    label: "全体",
    tag: "まず1枚",
    guidance: "商品全体が分かる正面寄りの写真",
  },
  {
    id: "label",
    label: "識別情報",
    tag: "任意",
    guidance: "ロゴ・型番・刻印・タグをアップで",
  },
  {
    id: "damage",
    label: "状態情報",
    tag: "任意",
    guidance: "傷・角スレ・汚れ・破損をアップで",
  },
] as const;

function formatCurrency(amount: number): string {
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

export default function HomePage() {
  const [previews, setPreviews] = useState<PreviewState[]>([
    EMPTY_SLOT,
    EMPTY_SLOT,
    EMPTY_SLOT,
  ]);
  const [result, setResult] = useState<AppraisalResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorReference, setErrorReference] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [historyItems, setHistoryItems] = useState<AppraisalHistoryItem[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [isHistoryLoading, setIsHistoryLoading] = useState(true);
  const [historyEnabled, setHistoryEnabled] = useState(false);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([null, null, null]);
  const resultsRef = useRef<HTMLElement>(null);
  const clientSessionIdRef = useRef<string | null>(null);

  const hasPhotos = previews.some((p) => p.file !== null);

  useEffect(() => {
    if (result && resultsRef.current) {
      resultsRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [result]);

  useEffect(() => {
    void loadHistory();
  }, []);

  useEffect(() => {
    clientSessionIdRef.current = getOrCreateClientSessionId();
  }, []);

  async function loadHistory(options?: { silent?: boolean }) {
    try {
      if (!options?.silent) {
        setIsHistoryLoading(true);
      }
      setHistoryError(null);
      const clientSessionId =
        clientSessionIdRef.current || getOrCreateClientSessionId();
      clientSessionIdRef.current = clientSessionId;
      const response = await fetch("/api/history", {
        cache: "no-store",
        headers: clientSessionId ? { "x-client-session-id": clientSessionId } : undefined,
      });
      const payload = await response.json();

      if (!response.ok) {
        const message = payload.error || "査定履歴の取得に失敗しました";
        const nextMessage =
          typeof payload.errorId === "string"
            ? `${message} (エラーID: ${payload.errorId})`
            : message;
        throw new Error(nextMessage);
      }

      setHistoryItems(Array.isArray(payload.items) ? payload.items : []);
      setHistoryEnabled(Boolean(payload.enabled));
    } catch (err) {
      if (err instanceof Error && !err.message.includes("エラーID:")) {
        void reportClientError({
          source: "history.load",
          message: err.message,
          errorName: err.name,
          stack: err.stack || null,
        });
      }
      setHistoryError(
        err instanceof Error ? err.message : "査定履歴の取得に失敗しました"
      );
    } finally {
      setIsHistoryLoading(false);
    }
  }

  function updatePreview(index: number, file: File | null) {
    setPreviews((current) =>
      current.map((preview, i) => {
        if (i !== index) return preview;
        if (preview.url) URL.revokeObjectURL(preview.url);
        return file ? { file, url: URL.createObjectURL(file) } : EMPTY_SLOT;
      })
    );
  }

  function handleFileChange(
    index: number,
    event: ChangeEvent<HTMLInputElement>
  ) {
    updatePreview(index, event.target.files?.[0] || null);
  }

  function removePhoto(index: number) {
    updatePreview(index, null);
    const input = inputRefs.current[index];
    if (input) input.value = "";
  }

  function handleReset() {
    for (const preview of previews) {
      if (preview.url) URL.revokeObjectURL(preview.url);
    }
    setPreviews([EMPTY_SLOT, EMPTY_SLOT, EMPTY_SLOT]);
    setResult(null);
    setError(null);
    setErrorReference(null);
    for (const input of inputRefs.current) {
      if (input) input.value = "";
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setErrorReference(null);
    setResult(null);

    const selectedPhotos = previews.flatMap((preview, index) =>
      preview.file
        ? [{ file: preview.file, slotLabel: PHOTO_SLOTS[index].label as string }]
        : []
    );

    if (selectedPhotos.length === 0) {
      setError("写真を1枚以上追加してください");
      return;
    }

    setIsPending(true);

    let serverErrorId: string | null = null;
    void (async () => {
      try {
        const formData = new FormData();
        for (const photo of selectedPhotos) {
          formData.append("images", photo.file);
          formData.append("imageSlotLabels", photo.slotLabel);
        }

        const clientSessionId =
          clientSessionIdRef.current || getOrCreateClientSessionId();
        clientSessionIdRef.current = clientSessionId;
        const response = await fetch("/api/appraisal", {
          method: "POST",
          headers: clientSessionId
            ? { "x-client-session-id": clientSessionId }
            : undefined,
          body: formData,
        });

        const payload = await response.json();
        if (!response.ok) {
          if (typeof payload.errorId === "string") {
            serverErrorId = payload.errorId;
            setErrorReference(payload.errorId);
          }
          throw new Error(payload.error || "査定に失敗しました");
        }

        const nextResult = payload as AppraisalResult;
        setResult(nextResult);

        if (nextResult.savedHistoryItem) {
          const savedHistoryItem = nextResult.savedHistoryItem;
          setHistoryEnabled(true);
          setHistoryItems((current) => {
            const deduped = current.filter((item) => item.id !== savedHistoryItem.id);
            return [savedHistoryItem, ...deduped].slice(0, 12);
          });
        }

        void loadHistory({ silent: true });
      } catch (err) {
        if (err instanceof Error && !serverErrorId) {
          void reportClientError({
            source: "appraisal.submit",
            message: err.message,
            errorName: err.name,
            stack: err.stack || null,
            metadata: {
              photoCount: selectedPhotos.length,
              slotLabels: selectedPhotos.map((photo) => photo.slotLabel),
            },
          });
        }
        setError(
          err instanceof Error ? err.message : "予期しないエラーが発生しました"
        );
      } finally {
        setIsPending(false);
      }
    })();
  }

  return (
    <div className={styles.app}>
      {/* Header */}
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <div className={styles.logo}>
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <rect width="20" height="20" rx="5" fill="#d4943a" />
              <path
                d="M10 4L16 10L10 16L4 10Z"
                fill="#09090b"
                opacity="0.85"
              />
              <circle cx="10" cy="10" r="2" fill="#d4943a" />
            </svg>
            <span>UME</span>
          </div>
          <span className={styles.headerTag}>査定ツール</span>
        </div>
      </header>

      {/* Main layout */}
      <div className={styles.layout}>
        {/* Capture panel */}
        <div className={styles.capture}>
          <form className={styles.captureForm} onSubmit={handleSubmit}>
            <div className={styles.captureGuide}>
              <p className={styles.captureLead}>
                写真は1枚でも査定できます。2枚目・3枚目は任意です。
              </p>
              <p className={styles.captureSublead}>
                精度を上げたい場合だけ、識別情報やダメージ写真を追加してください。
              </p>
            </div>

            <div className={styles.photoGrid}>
              {PHOTO_SLOTS.map((slot, index) => (
                <div key={slot.id} className={styles.photoSlotWrap}>
                  <label
                    className={`${styles.photoSlot} ${
                      previews[index].url ? styles.photoSlotFilled : ""
                    }`}
                  >
                    <input
                      ref={(el) => {
                        inputRefs.current[index] = el;
                      }}
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className={styles.fileInput}
                      onChange={(e) => handleFileChange(index, e)}
                    />
                    {previews[index].url ? (
                      <img
                        src={previews[index].url!}
                        alt={slot.label}
                        className={styles.photoPreview}
                      />
                    ) : (
                      <div className={styles.photoPlaceholder}>
                        <svg
                          width="24"
                          height="24"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" />
                          <circle cx="12" cy="13" r="4" />
                        </svg>
                      </div>
                    )}
                  </label>
                  {previews[index].url && (
                    <button
                      type="button"
                      className={styles.removeBtn}
                      onClick={() => removePhoto(index)}
                      aria-label="写真を削除"
                    >
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 12 12"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                      >
                        <path d="M2 2l8 8M10 2l-8 8" />
                      </svg>
                    </button>
                  )}
                  <div className={styles.slotMeta}>
                    <div className={styles.slotMetaHeader}>
                      <span className={styles.slotLabel}>{slot.label}</span>
                      <span
                        className={`${styles.slotTag} ${
                          index === 0 ? styles.slotTagPrimary : styles.slotTagOptional
                        }`}
                      >
                        {slot.tag}
                      </span>
                    </div>
                    <span className={styles.slotGuidance}>{slot.guidance}</span>
                  </div>
                </div>
              ))}
            </div>

            <div className={styles.actionGroup}>
              <button
                type="submit"
                className={styles.submitBtn}
                disabled={!hasPhotos || isPending}
              >
                {isPending ? (
                  <>
                    <span className={styles.spinner} />
                    査定中...
                  </>
                ) : (
                  "査定する"
                )}
              </button>

              {result && (
                <button
                  type="button"
                  className={styles.resetBtn}
                  onClick={handleReset}
                >
                  新規査定
                </button>
              )}
            </div>
          </form>

          {error && (
            <div className={styles.errorBanner}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <circle
                  cx="8"
                  cy="8"
                  r="7"
                  stroke="currentColor"
                  strokeWidth="1.5"
                />
                <path
                  d="M8 5v3.5M8 10.5v.5"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
              <span>{error}</span>
            </div>
          )}
          {error && errorReference && (
            <p className={styles.privacyNote}>エラーID: {errorReference}</p>
          )}

          <p className={styles.privacyNote}>
            査定に成功した写真と価格は履歴として保存されます
          </p>
        </div>

        {/* Results panel */}
        <section className={styles.main} ref={resultsRef}>
          {result ? (
            <div className={styles.resultFlow}>
              {/* Price hero */}
              <div className={styles.priceHero}>
                <span className={styles.priceLabel}>推奨Max価格</span>
                <div className={styles.priceValue}>
                  {formatCurrency(result.pricing.suggestedMaxPrice)}
                </div>
                <div className={styles.buyRange}>
                  <span className={styles.buyRangeLabel}>買取目安</span>
                  <span className={styles.buyRangeValue}>
                    {formatCurrency(result.pricing.buyPriceRangeLow)}
                    {" – "}
                    {formatCurrency(result.pricing.buyPriceRangeHigh)}
                  </span>
                </div>
              </div>

              {/* Price comparison */}
              <div className={styles.priceComparison}>
                <div className={styles.priceCompItem}>
                  <span className={styles.compLabel}>比較下位帯</span>
                  <span className={styles.compValue}>
                    {formatCurrency(result.pricing.low)}
                  </span>
                </div>
                <div className={styles.priceCompDivider} />
                <div className={styles.priceCompItem}>
                  <span className={styles.compLabel}>比較中央値</span>
                  <span className={styles.compValue}>
                    {formatCurrency(result.pricing.median)}
                  </span>
                </div>
              </div>

              {/* Warnings */}
              {result.warnings.length > 0 && (
                <div className={styles.warningBanner}>
                  {result.warnings.map((w) => (
                    <p key={w}>
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 14 14"
                        fill="none"
                      >
                        <path
                          d="M7 1L13 12H1L7 1z"
                          stroke="currentColor"
                          strokeWidth="1.2"
                          strokeLinejoin="round"
                        />
                        <path
                          d="M7 5.5v2.5M7 9.5v.5"
                          stroke="currentColor"
                          strokeWidth="1.2"
                          strokeLinecap="round"
                        />
                      </svg>
                      {w}
                    </p>
                  ))}
                </div>
              )}

              {/* Product identification */}
              <div className={styles.productCard}>
                <div className={styles.productTop}>
                  <h2 className={styles.productName}>
                    {result.identification.itemName}
                  </h2>
                  <div className={styles.confidenceBadge}>
                    <span className={styles.confidenceValue}>
                      {Math.round(result.identification.confidence * 100)}%
                    </span>
                  </div>
                </div>

                <div className={styles.metaGrid}>
                  <div className={styles.metaItem}>
                    <span className={styles.metaLabel}>ブランド</span>
                    <span className={styles.metaValue}>
                      {result.identification.brand || "不明"}
                    </span>
                  </div>
                  <div className={styles.metaItem}>
                    <span className={styles.metaLabel}>型番</span>
                    <span className={styles.metaValue}>
                      {result.identification.model || "不明"}
                    </span>
                  </div>
                  <div className={styles.metaItem}>
                    <span className={styles.metaLabel}>カテゴリ</span>
                    <span className={styles.metaValue}>
                      {result.identification.category}
                    </span>
                  </div>
                  <div className={styles.metaItem}>
                    <span className={styles.metaLabel}>検索語</span>
                    <span className={styles.metaValue}>
                      {result.identification.searchQuery}
                    </span>
                  </div>
                </div>

                {result.identification.conditionSummary && (
                  <p className={styles.conditionNote}>
                    {result.identification.conditionSummary}
                  </p>
                )}

                {result.savedHistoryAt && (
                  <p className={styles.savedNote}>
                    この査定は履歴に保存済みです · {formatDateTime(result.savedHistoryAt)}
                  </p>
                )}
              </div>

              {/* Similar listings */}
              {result.listings.length > 0 && (
                <div className={styles.listingsSection}>
                  <h3 className={styles.sectionHeading}>
                    類似出品
                    <span className={styles.listingCount}>
                      {result.listings.length}
                    </span>
                  </h3>
                  <div className={styles.listingScroll}>
                    {result.listings.map((listing) => (
                      <a
                        key={listing.id}
                        className={styles.listingCard}
                        href={listing.itemWebUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <div className={styles.listingImgWrap}>
                          {listing.imageUrl ? (
                            <img
                              src={listing.imageUrl}
                              alt=""
                              className={styles.listingImg}
                            />
                          ) : (
                            <div className={styles.listingImgEmpty} />
                          )}
                        </div>
                        <div className={styles.listingBody}>
                          <span className={styles.listingPrice}>
                            {formatCurrency(listing.totalPrice.amount)}
                          </span>
                          <span className={styles.listingTitle}>
                            {listing.title}
                          </span>
                          <span className={styles.listingMeta}>
                            {listing.condition} · {listing.location}
                          </span>
                        </div>
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {/* Formula & Debug */}
              <div className={styles.footer}>
                <p className={styles.formula}>{result.pricing.formula}</p>

                {result.debug && (
                  <details className={styles.debugDetails}>
                    <summary>診断情報</summary>
                    <div className={styles.debugContent}>
                      <p>
                        採用画像:{" "}
                        {result.debug.selectedImageIndex !== null
                          ? `${result.debug.selectedImageIndex + 1}枚目`
                          : "なし"}
                        {result.debug.queryStage
                          ? ` | 品名検索: ${result.debug.queryStage.filteredListingCount}件`
                          : ""}
                      </p>
                      <ul>
                        {result.debug.imageStages.map((stage) => (
                          <li key={stage.imageIndex}>
                            {stage.imageIndex + 1}枚目: raw{" "}
                            {stage.rawListingCount} / used{" "}
                            {stage.usedListingCount} / 採用{" "}
                            {stage.selectedListingCount} / score {stage.score}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </details>
                )}
              </div>
            </div>
          ) : isPending ? (
            <div className={styles.loadingState}>
              <div className={styles.loadingDots}>
                <span />
                <span />
                <span />
              </div>
              <p>写真を分析しています...</p>
            </div>
          ) : (
            <div className={styles.emptyState}>
              <svg
                width="48"
                height="48"
                viewBox="0 0 48 48"
                fill="none"
                stroke="currentColor"
                strokeWidth="1"
                opacity="0.3"
              >
                <rect x="4" y="8" width="40" height="32" rx="4" />
                <circle cx="24" cy="24" r="8" />
                <path d="M16 8l2-4h12l2 4" />
              </svg>
              <p>
                商品の写真を撮影して
                <br />
                査定を開始
              </p>
            </div>
          )}

          <div className={styles.historySection}>
            <div className={styles.historyHeader}>
              <h3 className={styles.sectionHeading}>査定履歴</h3>
              {historyEnabled && historyItems.length > 0 && (
                <span className={styles.historyCount}>{historyItems.length}件</span>
              )}
            </div>

            {historyError ? (
              <p className={styles.historyStatus}>{historyError}</p>
            ) : !historyEnabled ? (
              <p className={styles.historyStatus}>
                履歴保存ストレージが未設定のため、まだ一覧は表示されません。
              </p>
            ) : isHistoryLoading ? (
              <p className={styles.historyStatus}>履歴を読み込んでいます...</p>
            ) : historyItems.length === 0 ? (
              <p className={styles.historyStatus}>まだ保存された査定はありません。</p>
            ) : (
              <div className={styles.historyGrid}>
                {historyItems.map((item) => (
                  <article key={item.id} className={styles.historyCard}>
                    <div className={styles.historyImages}>
                      {item.images.map((image) => (
                        <a
                          key={image.pathname}
                          href={image.url}
                          target="_blank"
                          rel="noreferrer"
                          className={styles.historyImageLink}
                        >
                          <img
                            src={image.url}
                            alt={image.slotLabel}
                            className={styles.historyImage}
                          />
                          <span className={styles.historyImageBadge}>
                            {image.slotLabel}
                          </span>
                        </a>
                      ))}
                    </div>

                    <div className={styles.historyBody}>
                      <div className={styles.historyCardTop}>
                        <h4 className={styles.historyItemName}>
                          {item.identification.itemName}
                        </h4>
                        <span className={styles.historyItemPrice}>
                          {formatCurrency(item.pricing.suggestedMaxPrice)}
                        </span>
                      </div>

                      <p className={styles.historyMeta}>
                        {formatDateTime(item.createdAt)}
                        {" · "}
                        {item.identification.brand || item.identification.category}
                      </p>

                      <div className={styles.historyPriceRow}>
                        <span>
                          買取目安{" "}
                          {formatCurrency(item.pricing.buyPriceRangeLow)}
                          {" – "}
                          {formatCurrency(item.pricing.buyPriceRangeHigh)}
                        </span>
                        <span>{item.pricing.listingCount}件参照</span>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
