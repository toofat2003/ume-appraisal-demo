"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import styles from "./page.module.css";
import type { AppraisalHistoryItem } from "@/lib/appraisal/types";
import {
  groupHistoryItems,
  mergeStoredAppointmentsWithHistory,
  renameStoredAppointment,
  StoredAppointment,
} from "@/lib/appointments/shared";
import {
  persistActiveAppointment,
  persistStoredAppointments,
  readStoredAppointment,
  readStoredAppointments,
} from "@/lib/appointments/client";
import {
  getOrCreateClientSessionId,
  reportClientError,
} from "@/lib/observability/client";

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

export default function AppointmentDetailPage() {
  const params = useParams<{ appointmentId: string }>();
  const appointmentId = decodeURIComponent(params.appointmentId);
  const [items, setItems] = useState<AppraisalHistoryItem[]>([]);
  const [storedAppointments, setStoredAppointments] = useState<StoredAppointment[]>([]);
  const [appointmentLabel, setAppointmentLabel] = useState("アポ詳細");
  const [renameValue, setRenameValue] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorReference, setErrorReference] = useState<string | null>(null);
  const [renameError, setRenameError] = useState<string | null>(null);
  const clientSessionIdRef = useRef<string | null>(null);

  const appointmentGroup = useMemo(() => {
    return (
      groupHistoryItems(items).find((group) => group.appointmentId === appointmentId) || null
    );
  }, [appointmentId, items]);

  useEffect(() => {
    clientSessionIdRef.current = getOrCreateClientSessionId();
    const registry = readStoredAppointments();
    setStoredAppointments(registry);
    const stored = registry.find((item) => item.id === appointmentId);
    if (stored) {
      setAppointmentLabel(stored.label);
      setRenameValue(stored.label);
    }
  }, [appointmentId]);

  useEffect(() => {
    void loadAppointment();
  }, [appointmentId]);

  async function loadAppointment(options?: { silent?: boolean }) {
    try {
      if (!options?.silent) {
        setIsLoading(true);
      }
      setError(null);
      setErrorReference(null);
      const clientSessionId =
        clientSessionIdRef.current || getOrCreateClientSessionId();
      clientSessionIdRef.current = clientSessionId;
      const response = await fetch(
        `/api/history?appointmentId=${encodeURIComponent(appointmentId)}&limit=200`,
        {
          cache: "no-store",
          headers: clientSessionId
            ? { "x-client-session-id": clientSessionId }
            : undefined,
        }
      );
      const payload = await response.json();

      if (!response.ok) {
        const message = payload.error || "アポ詳細の取得に失敗しました";
        if (typeof payload.errorId === "string") {
          setErrorReference(payload.errorId);
        }
        throw new Error(message);
      }

      const nextItems = Array.isArray(payload.items) ? payload.items : [];
      setItems(nextItems);
      setStoredAppointments((current) => {
        const next = mergeStoredAppointmentsWithHistory(current, nextItems);
        persistStoredAppointments(next);
        return next;
      });

      const nextLabel =
        payload.appointment?.appointmentLabel ||
        nextItems[0]?.appointmentLabel ||
        readStoredAppointments().find((item) => item.id === appointmentId)?.label ||
        "未命名アポ";
      setAppointmentLabel(nextLabel);
      setRenameValue(nextLabel);
    } catch (err) {
      if (err instanceof Error) {
        void reportClientError({
          source: "appointment.detail.load",
          message: err.message,
          errorName: err.name,
          stack: err.stack || null,
          metadata: {
            appointmentId,
          },
        });
      }
      setError(
        err instanceof Error ? err.message : "アポ詳細の取得に失敗しました"
      );
    } finally {
      setIsLoading(false);
    }
  }

  async function handleRename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextLabel = renameValue.trim();

    if (!nextLabel) {
      setRenameError("アポ名を入力してください");
      return;
    }

    setIsSaving(true);
    setRenameError(null);
    setError(null);
    setErrorReference(null);

    try {
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
          appointmentId,
          appointmentLabel: nextLabel,
        }),
      });
      const payload = await response.json();

      if (!response.ok) {
        const message = payload.error || "アポ名の変更に失敗しました";
        if (typeof payload.errorId === "string") {
          setErrorReference(payload.errorId);
        }
        throw new Error(message);
      }

      setItems((current) =>
        current.map((item) => ({
          ...item,
          appointmentLabel: nextLabel,
        }))
      );
      setAppointmentLabel(nextLabel);
      setStoredAppointments((current) => {
        const next = renameStoredAppointment(current, appointmentId, nextLabel);
        persistStoredAppointments(next);
        return next;
      });

      const active = readStoredAppointment();
      if (active?.id === appointmentId) {
        persistActiveAppointment({
          id: appointmentId,
          label: nextLabel,
        });
      }
    } catch (err) {
      if (err instanceof Error) {
        void reportClientError({
          source: "appointment.detail.rename",
          message: err.message,
          errorName: err.name,
          stack: err.stack || null,
          metadata: {
            appointmentId,
          },
        });
      }
      setRenameError(
        err instanceof Error ? err.message : "アポ名の変更に失敗しました"
      );
    } finally {
      setIsSaving(false);
    }
  }

  const itemCount = appointmentGroup?.itemCount || 0;
  const totalSuggestedMaxPrice = appointmentGroup?.totalSuggestedMaxPrice || 0;
  const latestAppraisalAt = appointmentGroup?.latestAppraisalAt || null;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link href="/" className={styles.backLink}>
          ← 査定画面に戻る
        </Link>
        <span className={styles.headerTag}>アポ詳細</span>
      </header>

      <main className={styles.main}>
        <section className={styles.hero}>
          <div className={styles.heroMeta}>
            <p className={styles.heroLabel}>アポ名</p>
            <h1 className={styles.heroTitle}>{appointmentLabel}</h1>
            <p className={styles.heroCaption}>
              {latestAppraisalAt
                ? `${formatDateTime(latestAppraisalAt)} · ${itemCount}件`
                : "まだ査定は保存されていません"}
            </p>
          </div>
          <div className={styles.heroSummary}>
            <span className={styles.heroSummaryLabel}>推奨Max合計</span>
            <span className={styles.heroSummaryValue}>
              {formatCurrency(totalSuggestedMaxPrice)}
            </span>
          </div>
        </section>

        <section className={styles.renameSection}>
          <form className={styles.renameForm} onSubmit={handleRename}>
            <label className={styles.renameLabel}>
              アポ名を変更
              <input
                type="text"
                value={renameValue}
                onChange={(event) => setRenameValue(event.target.value)}
                className={styles.renameInput}
                placeholder="例: Aさん宅 4/20 午前"
              />
            </label>
            <button type="submit" className={styles.renameButton} disabled={isSaving}>
              {isSaving ? "保存中..." : "名前を保存"}
            </button>
          </form>
          {renameError && <p className={styles.messageError}>{renameError}</p>}
        </section>

        {error && (
          <section className={styles.messageSection}>
            <p className={styles.messageError}>{error}</p>
            {errorReference && (
              <p className={styles.messageMeta}>エラーID: {errorReference}</p>
            )}
          </section>
        )}

        <section className={styles.itemsSection}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>このアポの査定履歴</h2>
            <span className={styles.sectionCount}>{itemCount}件</span>
          </div>

          {isLoading ? (
            <p className={styles.messageMuted}>読み込んでいます...</p>
          ) : items.length === 0 ? (
            <p className={styles.messageMuted}>
              まだこのアポに保存された査定はありません。査定画面から写真を送ると、このページにまとまって表示されます。
            </p>
          ) : (
            <div className={styles.itemGrid}>
              {items.map((item) => (
                <article key={item.id} className={styles.itemCard}>
                  <div className={styles.itemImages}>
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
                          className={styles.image}
                        />
                        <span className={styles.imageBadge}>{image.slotLabel}</span>
                      </a>
                    ))}
                  </div>

                  <div className={styles.itemBody}>
                    <div className={styles.itemTop}>
                      <h3 className={styles.itemName}>{item.identification.itemName}</h3>
                      <span className={styles.itemPrice}>
                        {formatCurrency(item.pricing.suggestedMaxPrice)}
                      </span>
                    </div>
                    <p className={styles.itemMeta}>
                      {formatDateTime(item.createdAt)}
                      {" · "}
                      {item.identification.brand || item.identification.category}
                    </p>
                    <p className={styles.itemPriceRow}>
                      買取目安 {formatCurrency(item.pricing.buyPriceRangeLow)}
                      {" – "}
                      {formatCurrency(item.pricing.buyPriceRangeHigh)}
                      {" · "}
                      {item.pricing.listingCount}件参照
                    </p>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
