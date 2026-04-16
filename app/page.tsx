"use client";

import { ChangeEvent, FormEvent, useEffect, useRef, useState } from "react";
import styles from "./page.module.css";
import type { AppraisalResult } from "@/lib/appraisal/types";

type PreviewState = {
  file: File | null;
  url: string | null;
};

const EMPTY_SLOT: PreviewState = { file: null, url: null };

const PHOTO_SLOTS = [
  { id: "overview", label: "全体" },
  { id: "label", label: "型番" },
  { id: "damage", label: "ダメージ" },
] as const;

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(amount);
}

export default function HomePage() {
  const [previews, setPreviews] = useState<PreviewState[]>([
    EMPTY_SLOT,
    EMPTY_SLOT,
    EMPTY_SLOT,
  ]);
  const [result, setResult] = useState<AppraisalResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([null, null, null]);
  const resultsRef = useRef<HTMLElement>(null);

  const hasPhotos = previews.some((p) => p.file !== null);

  useEffect(() => {
    if (result && resultsRef.current) {
      resultsRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [result]);

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
    for (const input of inputRefs.current) {
      if (input) input.value = "";
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setResult(null);

    const files = previews
      .map((p) => p.file)
      .filter((f): f is File => f !== null);

    if (files.length === 0) {
      setError("写真を1枚以上追加してください");
      return;
    }

    setIsPending(true);

    void (async () => {
      try {
        const formData = new FormData();
        for (const file of files) formData.append("images", file);

        const response = await fetch("/api/appraisal", {
          method: "POST",
          body: formData,
        });

        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.error || "査定に失敗しました");
        }

        setResult(payload as AppraisalResult);
      } catch (err) {
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
                      accept="image/png,image/jpeg,image/webp"
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
                  <span className={styles.slotLabel}>{slot.label}</span>
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

          <p className={styles.privacyNote}>画像はサーバーに保存されません</p>
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
        </section>
      </div>
    </div>
  );
}
