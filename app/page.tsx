"use client";

import { ChangeEvent, FormEvent, useEffect, useState, useTransition } from "react";
import styles from "./page.module.css";
import type { AppraisalResult } from "@/lib/appraisal/types";

type PreviewState = {
  file: File | null;
  url: string | null;
};

const EMPTY_SLOT: PreviewState = {
  file: null,
  url: null,
};

const INPUT_LABELS = [
  {
    title: "1. 全体写真",
    hint: "商品全体が正面から見える写真を入れてください。バッグ、時計、小型家電、箱物が特に向いています。",
  },
  {
    title: "2. 型番・ラベル",
    hint: "シリアル、内タグ、ロゴプレート、背面ラベルなどが読める写真を入れてください。",
  },
  {
    title: "3. ダメージ写真",
    hint: "傷、汚れ、欠品、角スレなどがあれば入れてください。査定の妥当性確認に使います。",
  },
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
  const [isPending, startAppraisal] = useTransition();

  useEffect(() => {
    return () => {
      for (const preview of previews) {
        if (preview.url) {
          URL.revokeObjectURL(preview.url);
        }
      }
    };
  }, [previews]);

  function updatePreview(index: number, file: File | null) {
    setPreviews((current) =>
      current.map((preview, previewIndex) => {
        if (previewIndex !== index) {
          return preview;
        }

        if (preview.url) {
          URL.revokeObjectURL(preview.url);
        }

        return file
          ? {
              file,
              url: URL.createObjectURL(file),
            }
          : EMPTY_SLOT;
      })
    );
  }

  function handleFileChange(index: number, event: ChangeEvent<HTMLInputElement>) {
    updatePreview(index, event.target.files?.[0] || null);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const files = previews.map((preview) => preview.file).filter((file): file is File => file !== null);

    if (files.length === 0) {
      setError("査定を実行する前に、少なくとも1枚の画像をアップロードしてください。");
      return;
    }

    startAppraisal(() => {
      void (async () => {
        try {
          const formData = new FormData();

          for (const file of files) {
            formData.append("images", file);
          }

          const response = await fetch("/api/appraisal", {
            method: "POST",
            body: formData,
          });

          const payload = await response.json();

          if (!response.ok) {
            throw new Error(payload.error || "査定の生成に失敗しました。");
          }

          setResult(payload as AppraisalResult);
        } catch (submitError) {
          setResult(null);
          setError(
            submitError instanceof Error
              ? submitError.message
              : "査定の生成中に予期しないエラーが発生しました。"
          );
        }
      })();
    });
  }

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <section className={styles.hero}>
          <article className={`${styles.heroCard} ${styles.panel}`}>
            <span className={styles.eyebrow}>梅Plan モック</span>
            <h1 className={styles.title}>写真を入れると、仮のMax価格がすぐ返る。</h1>
            <p className={styles.lead}>
              このモックは、1〜3枚の写真を eBay `searchByImage` にかけて類似出品を取得し、
              現場担当が一次判断に使える `Max価格` の叩き台を返します。
            </p>

            <div className={styles.heroStats}>
              <div className={styles.stat}>
                <span className={styles.statLabel}>商品特定</span>
                <span className={styles.statValue}>eBay `searchByImage`</span>
              </div>
              <div className={styles.stat}>
                <span className={styles.statLabel}>価格ソース</span>
                <span className={styles.statValue}>eBay 出品価格</span>
              </div>
              <div className={styles.stat}>
                <span className={styles.statLabel}>出力内容</span>
                <span className={styles.statValue}>`Max価格` + 類似出品</span>
              </div>
            </div>
          </article>

          <aside className={styles.heroAside}>
            <div className={styles.asideCard}>
              <p className={styles.asideTitle}>必要な環境変数</p>
              <ul className={styles.asideList}>
                <li>`EBAY_CLIENT_ID`</li>
                <li>`EBAY_CLIENT_SECRET`</li>
                <li>`EBAY_MARKETPLACE_ID=EBAY_US`</li>
              </ul>
            </div>
            <div className={styles.asideCard}>
              <p className={styles.asideTitle}>現在のロジック</p>
              <ul className={styles.asideList}>
                <li>最初に eBay `searchByImage` で商品候補を探す</li>
                <li>出品総額の `p25` を売却価格の基準として使う</li>
                <li>件数ベースの確信度補正を掛ける</li>
                <li>確定買取価格ではなく、現場向けの目安レンジを返す</li>
              </ul>
            </div>
          </aside>
        </section>

        <section className={styles.grid}>
          <form className={styles.panel} onSubmit={handleSubmit}>
            <h2 className={styles.sectionTitle}>写真アップロード</h2>
            <p className={styles.sectionLead}>
              1枚目は全体写真を推奨します。`searchByImage` は1枚の画像から類似出品を探すため、
              ダメージ写真より商品全体が写った写真のほうが安定します。
            </p>

            <div className={styles.uploadGrid}>
              {INPUT_LABELS.map((label, index) => (
                <label key={label.title} className={styles.uploadLabel}>
                  <span className={styles.labelTitle}>{label.title}</span>
                  <span className={styles.labelHint}>{label.hint}</span>
                  <input
                    className={styles.fileInput}
                    accept="image/png,image/jpeg,image/webp"
                    type="file"
                    onChange={(event) => handleFileChange(index, event)}
                  />
                </label>
              ))}
            </div>

            <div className={styles.previewGrid}>
              {previews.map((preview, index) => (
                <div key={INPUT_LABELS[index].title} className={styles.previewCard}>
                  {preview.url ? (
                    <img alt={INPUT_LABELS[index].title} src={preview.url} />
                  ) : (
                    <div className={styles.placeholder}>{INPUT_LABELS[index].title}</div>
                  )}
                </div>
              ))}
            </div>

            <div className={styles.submitRow}>
              <button className={styles.button} disabled={isPending} type="submit">
                {isPending ? "査定中..." : "モック査定を実行"}
              </button>
              <span className={styles.muted}>
                画像保存はしていません。このリクエストの処理にだけサーバーへ送信します。
              </span>
            </div>

            {error ? <div className={styles.error}>{error}</div> : null}
          </form>

          <section className={styles.resultStack}>
            {result ? (
              <>
                <article className={styles.resultCard}>
                  <div className={styles.badgeRow}>
                    <span className={styles.badge}>{result.identification.category}</span>
                    <span className={styles.badge}>
                      確信度 {Math.round(result.identification.confidence * 100)}%
                    </span>
                    <span className={styles.badge}>
                      検索語: {result.identification.searchQuery}
                    </span>
                  </div>

                  <h2 className={styles.idTitle}>{result.identification.itemName}</h2>
                  <p className={styles.idMeta}>
                    ブランド: {result.identification.brand || "不明"} | 型番:{" "}
                    {result.identification.model || "不明"} | 状態メモ:{" "}
                    {result.identification.conditionSummary}
                  </p>
                  <p className={styles.idMeta}>{result.identification.reasoning}</p>

                  <div className={styles.priceGrid}>
                    <div className={styles.priceTile}>
                      <span className={styles.statLabel}>比較価格 下位帯</span>
                      <strong>{formatCurrency(result.pricing.low)}</strong>
                    </div>
                    <div className={styles.priceTile}>
                      <span className={styles.statLabel}>比較価格 中央値</span>
                      <strong>{formatCurrency(result.pricing.median)}</strong>
                    </div>
                    <div className={styles.priceTile}>
                      <span className={styles.statLabel}>推奨Max価格</span>
                      <strong>{formatCurrency(result.pricing.suggestedMaxPrice)}</strong>
                    </div>
                  </div>

                  <p className={styles.formula}>
                    買取目安: {formatCurrency(result.pricing.buyPriceRangeLow)} -{" "}
                    {formatCurrency(result.pricing.buyPriceRangeHigh)} | 算出式: {result.pricing.formula}
                  </p>

                  {result.warnings.length > 0 ? (
                    <ul className={styles.warningList}>
                      {result.warnings.map((warning) => (
                        <li key={warning}>{warning}</li>
                      ))}
                    </ul>
                  ) : null}
                </article>

                <article className={styles.resultCard}>
                  <h2 className={styles.sectionTitle}>類似出品</h2>
                  <p className={styles.sectionLead}>
                    ここで見ているのは eBay `searchByImage` の一致結果です。成約価格ではなく出品価格なので、
                    梅Planの一次目安として使う前提です。
                  </p>

                  <div className={styles.listingGrid}>
                    {result.listings.map((listing) => (
                      <article className={styles.listingCard} key={listing.id}>
                        <div className={styles.listingThumb}>
                          {listing.imageUrl ? (
                            <img alt={listing.title} src={listing.imageUrl} />
                          ) : (
                            <div className={styles.placeholder}>画像なし</div>
                          )}
                        </div>

                        <div>
                          <h3 className={styles.listingTitle}>{listing.title}</h3>
                          <p className={styles.listingMeta}>
                            {listing.condition} | {listing.location} | 出品者: {listing.seller}
                          </p>
                          <p className={styles.listingMeta}>
                            商品価格: {formatCurrency(listing.price.amount)}
                            {listing.shipping
                              ? ` + 送料 ${formatCurrency(listing.shipping.amount)}`
                              : " + 送料記載なし"}
                          </p>
                          <p className={styles.listingMeta}>
                            参照総額: {formatCurrency(listing.totalPrice.amount)}
                          </p>
                          <a
                            className={styles.listingLink}
                            href={listing.itemWebUrl}
                            rel="noreferrer"
                            target="_blank"
                          >
                            eBayで開く
                          </a>
                        </div>
                      </article>
                    ))}
                  </div>
                </article>
              </>
            ) : (
              <div className={styles.emptyCard}>
                <div>
                  <h2>Waiting for photos</h2>
                  <p>
                    商品全体の写真とラベル写真を入れると、商品候補、類似出品、仮のMax価格を返します。
                  </p>
                </div>
              </div>
            )}
          </section>
        </section>
      </div>
    </main>
  );
}
