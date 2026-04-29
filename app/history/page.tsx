"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import styles from "./page.module.css";
import type { AppraisalHistoryItem } from "@/lib/appraisal/types";
import { getEffectiveMaxPrice, groupHistoryItems } from "@/lib/appointments/shared";

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

export default function HistoryPage() {
  const [items, setItems] = useState<AppraisalHistoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "contracted" | "open">("all");

  useEffect(() => {
    void (async () => {
      try {
        setIsLoading(true);
        setError(null);
        const response = await fetch("/api/history?limit=300", { cache: "no-store" });
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload.error || "査定履歴の取得に失敗しました");
        }

        setItems(Array.isArray(payload.items) ? payload.items : []);
      } catch (err) {
        setError(err instanceof Error ? err.message : "査定履歴の取得に失敗しました");
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const filteredItems = useMemo(
    () =>
      items.filter((item) => {
        if (filter === "contracted") return item.isContracted;
        if (filter === "open") return !item.isContracted;
        return true;
      }),
    [filter, items]
  );
  const groups = groupHistoryItems(filteredItems);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link href="/" className={styles.backLink}>
          ← 査定画面に戻る
        </Link>
        <span className={styles.headerTag}>過去案件</span>
      </header>

      <main className={styles.main}>
        <section className={styles.hero}>
          <div>
            <p className={styles.heroLabel}>履歴一覧</p>
            <h1 className={styles.heroTitle}>過去案件詳細</h1>
            <p className={styles.heroCaption}>
              現在の査定画面とは分けて、保存済みアポを確認できます。
            </p>
          </div>
          <div className={styles.summary}>
            <span>{groups.length}アポ</span>
            <strong>{filteredItems.length}件</strong>
          </div>
        </section>

        <div className={styles.filterTabs}>
          <button
            type="button"
            className={filter === "all" ? styles.filterTabActive : styles.filterTab}
            onClick={() => setFilter("all")}
          >
            すべて
          </button>
          <button
            type="button"
            className={filter === "contracted" ? styles.filterTabActive : styles.filterTab}
            onClick={() => setFilter("contracted")}
          >
            成約済み
          </button>
          <button
            type="button"
            className={filter === "open" ? styles.filterTabActive : styles.filterTab}
            onClick={() => setFilter("open")}
          >
            未成約
          </button>
        </div>

        {error ? (
          <p className={styles.messageError}>{error}</p>
        ) : isLoading ? (
          <p className={styles.messageMuted}>読み込んでいます...</p>
        ) : groups.length === 0 ? (
          <p className={styles.messageMuted}>該当する履歴はありません。</p>
        ) : (
          <div className={styles.groupList}>
            {groups.map((group) => (
              <section
                key={group.appointmentId || `ungrouped-${group.items[0]?.id || "empty"}`}
                className={styles.groupCard}
              >
                <div className={styles.groupHeader}>
                  <div>
                    <h2>{group.appointmentLabel}</h2>
                    <p>
                      {formatDateTime(group.latestAppraisalAt)} / 対象{group.itemCount}件 / 全
                      {group.totalItemCount}件
                    </p>
                  </div>
                  <div className={styles.groupTotals}>
                    <span>MAX {formatCurrency(group.totalSuggestedMaxPrice)}</span>
                    <span>オファー {formatCurrency(group.totalOfferPrice)}</span>
                  </div>
                </div>
                {group.appointmentId && (
                  <Link
                    href={`/appointments/${group.appointmentId}`}
                    className={styles.detailLink}
                  >
                    アポ詳細を開く
                  </Link>
                )}
                <div className={styles.itemList}>
                  {group.items.slice(0, 6).map((item) => (
                    <Link
                      href={`/appraisals/${item.id}`}
                      key={item.id}
                      className={styles.itemRow}
                    >
                      <span>{item.isContracted ? "✅" : "□"}</span>
                      <span>{item.identification.itemName}</span>
                      <strong>{formatCurrency(getEffectiveMaxPrice(item))}</strong>
                    </Link>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
