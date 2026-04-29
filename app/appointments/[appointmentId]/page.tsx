"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import styles from "./page.module.css";
import type { AppraisalHistoryItem } from "@/lib/appraisal/types";
import {
  getConditionRankLabel,
  getEffectiveMaxPrice,
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

const USD_TO_JPY_RATE = Number(process.env.NEXT_PUBLIC_USD_TO_JPY_RATE || "155");

function formatYenFromUsd(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) {
    return "-";
  }

  return new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: "JPY",
    maximumFractionDigits: 0,
  }).format(Math.round(amount * USD_TO_JPY_RATE));
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function isManualHistoryItem(item: AppraisalHistoryItem): boolean {
  return item.pricing.listingCount === 0 && item.identification.conditionSummary === "手動入力";
}

export default function AppointmentDetailPage() {
  const params = useParams<{ appointmentId: string }>();
  const appointmentId = decodeURIComponent(params.appointmentId);
  const [items, setItems] = useState<AppraisalHistoryItem[]>([]);
  const [storedAppointments, setStoredAppointments] = useState<StoredAppointment[]>([]);
  const [appointmentLabel, setAppointmentLabel] = useState("アポ詳細");
  const [renameValue, setRenameValue] = useState("");
  const [manualItemName, setManualItemName] = useState("");
  const [manualPriceUsd, setManualPriceUsd] = useState("");
  const [manualPhoto, setManualPhoto] = useState<{ file: File; url: string } | null>(null);
  const [inlineEditValues, setInlineEditValues] = useState<
    Record<string, { itemName: string; manualMaxPrice: string; offerPrice: string }>
  >({});
  const [imageUploadingItemId, setImageUploadingItemId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isManualSaving, setIsManualSaving] = useState(false);
  const [updatingItemId, setUpdatingItemId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorReference, setErrorReference] = useState<string | null>(null);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [manualError, setManualError] = useState<string | null>(null);
  const [manualSuccess, setManualSuccess] = useState<string | null>(null);
  const [itemFilter, setItemFilter] = useState<"all" | "contracted" | "open">("all");
  const clientSessionIdRef = useRef<string | null>(null);
  const manualPhotoInputRef = useRef<HTMLInputElement | null>(null);

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

  useEffect(() => {
    return () => {
      if (manualPhoto?.url) {
        URL.revokeObjectURL(manualPhoto.url);
      }
    };
  }, [manualPhoto?.url]);

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
      setInlineEditValues(
        Object.fromEntries(
          (nextItems as AppraisalHistoryItem[]).map((item) => [
            item.id,
            {
              itemName: item.identification.itemName,
              manualMaxPrice:
                item.manualMaxPrice === null ? "" : String(item.manualMaxPrice),
              offerPrice: item.offerPrice === null ? "" : String(item.offerPrice),
            },
          ])
        )
      );
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

  async function handleManualSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setManualError(null);
    setManualSuccess(null);

    const itemName = manualItemName.trim();
    const priceUsd = Number(manualPriceUsd);

    if (!itemName) {
      setManualError("品目名を入力してください");
      return;
    }

    if (!Number.isFinite(priceUsd) || priceUsd <= 0) {
      setManualError("価格は1ドル以上の数値で入力してください");
      return;
    }

    setIsManualSaving(true);
    setError(null);
    setErrorReference(null);

    try {
      const clientSessionId =
        clientSessionIdRef.current || getOrCreateClientSessionId();
      clientSessionIdRef.current = clientSessionId;
      const formData = new FormData();
      formData.append("itemName", itemName);
      formData.append("priceUsd", String(priceUsd));
      formData.append("appointmentId", appointmentId);
      formData.append("appointmentLabel", appointmentLabel);
      if (manualPhoto) {
        formData.append("images", manualPhoto.file);
        formData.append("imageSlotLabels", "手動入力写真");
      }

      const response = await fetch("/api/history", {
        method: "POST",
        headers: clientSessionId ? { "x-client-session-id": clientSessionId } : undefined,
        body: formData,
      });
      const payload = await response.json();

      if (!response.ok) {
        const message = payload.error || "手動入力の保存に失敗しました";
        if (typeof payload.errorId === "string") {
          setErrorReference(payload.errorId);
        }
        throw new Error(message);
      }

      if (payload.item) {
        const savedItem = payload.item as AppraisalHistoryItem;
        setItems((current) => {
          const deduped = current.filter((item) => item.id !== savedItem.id);
          return [savedItem, ...deduped];
        });
        setStoredAppointments((current) => {
          const next = renameStoredAppointment(current, appointmentId, appointmentLabel);
          persistStoredAppointments(next);
          return next;
        });
      }

      setManualItemName("");
      setManualPriceUsd("");
      if (manualPhoto?.url) {
        URL.revokeObjectURL(manualPhoto.url);
      }
      setManualPhoto(null);
      if (manualPhotoInputRef.current) {
        manualPhotoInputRef.current.value = "";
      }
      setManualSuccess("手動入力を保存しました。");
      void loadAppointment({ silent: true });
    } catch (err) {
      if (err instanceof Error) {
        void reportClientError({
          source: "appointment.detail.manual",
          message: err.message,
          errorName: err.name,
          stack: err.stack || null,
          metadata: {
            appointmentId,
            itemName,
          },
        });
      }
      setManualError(
        err instanceof Error ? err.message : "手動入力の保存に失敗しました"
      );
    } finally {
      setIsManualSaving(false);
    }
  }

  function handleManualPhotoChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] || null;
    setManualPhoto((current) => {
      if (current?.url) {
        URL.revokeObjectURL(current.url);
      }
      return file ? { file, url: URL.createObjectURL(file) } : null;
    });
  }

  function removeManualPhoto() {
    setManualPhoto((current) => {
      if (current?.url) {
        URL.revokeObjectURL(current.url);
      }
      return null;
    });
    if (manualPhotoInputRef.current) {
      manualPhotoInputRef.current.value = "";
    }
  }

  async function handleToggleExcluded(item: AppraisalHistoryItem) {
    setUpdatingItemId(item.id);
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
          itemId: item.id,
          isExcluded: !item.isExcluded,
        }),
      });
      const payload = await response.json();

      if (!response.ok) {
        const message = payload.error || "除外状態の更新に失敗しました";
        if (typeof payload.errorId === "string") {
          setErrorReference(payload.errorId);
        }
        throw new Error(message);
      }

      const updatedItem = payload.item as AppraisalHistoryItem;
      setItems((current) =>
        current.map((candidate) =>
          candidate.id === updatedItem.id ? updatedItem : candidate
        )
      );
    } catch (err) {
      if (err instanceof Error) {
        void reportClientError({
          source: "appointment.detail.exclude",
          message: err.message,
          errorName: err.name,
          stack: err.stack || null,
          metadata: {
            appointmentId,
            itemId: item.id,
          },
        });
      }
      setError(err instanceof Error ? err.message : "除外状態の更新に失敗しました");
    } finally {
      setUpdatingItemId(null);
    }
  }

  async function handleToggleContracted(item: AppraisalHistoryItem) {
    setUpdatingItemId(item.id);
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
          itemId: item.id,
          isContracted: !item.isContracted,
        }),
      });
      const payload = await response.json();

      if (!response.ok) {
        const message = payload.error || "成約状態の更新に失敗しました";
        if (typeof payload.errorId === "string") {
          setErrorReference(payload.errorId);
        }
        throw new Error(message);
      }

      const updatedItem = payload.item as AppraisalHistoryItem;
      setItems((current) =>
        current.map((candidate) =>
          candidate.id === updatedItem.id ? updatedItem : candidate
        )
      );
    } catch (err) {
      if (err instanceof Error) {
        void reportClientError({
          source: "appointment.detail.contract",
          message: err.message,
          errorName: err.name,
          stack: err.stack || null,
          metadata: {
            appointmentId,
            itemId: item.id,
          },
        });
      }
      setError(err instanceof Error ? err.message : "成約状態の更新に失敗しました");
    } finally {
      setUpdatingItemId(null);
    }
  }

  function updateInlineEditValue(
    item: AppraisalHistoryItem,
    field: "itemName" | "manualMaxPrice" | "offerPrice",
    value: string
  ) {
    setInlineEditValues((current) => {
      const existing = current[item.id] || {
        itemName: item.identification.itemName,
        manualMaxPrice: item.manualMaxPrice === null ? "" : String(item.manualMaxPrice),
        offerPrice: item.offerPrice === null ? "" : String(item.offerPrice),
      };

      return {
        ...current,
        [item.id]: {
          ...existing,
          [field]: value,
        },
      };
    });
  }

  function parseOptionalPrice(value: string): number | null {
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

  async function handleInlineSave(item: AppraisalHistoryItem) {
    const values = inlineEditValues[item.id] || {
      itemName: item.identification.itemName,
      manualMaxPrice: item.manualMaxPrice === null ? "" : String(item.manualMaxPrice),
      offerPrice: item.offerPrice === null ? "" : String(item.offerPrice),
    };
    const itemName = values.itemName.trim();

    if (!itemName) {
      setError("品目名を入力してください");
      return;
    }

    setUpdatingItemId(item.id);
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
          itemId: item.id,
          itemName,
          manualMaxPrice: parseOptionalPrice(values.manualMaxPrice),
          offerPrice: parseOptionalPrice(values.offerPrice),
        }),
      });
      const payload = await response.json();

      if (!response.ok) {
        const message = payload.error || "明細の保存に失敗しました";
        if (typeof payload.errorId === "string") {
          setErrorReference(payload.errorId);
        }
        throw new Error(message);
      }

      const updatedItem = payload.item as AppraisalHistoryItem;
      setItems((current) =>
        current.map((candidate) =>
          candidate.id === updatedItem.id ? updatedItem : candidate
        )
      );
      setInlineEditValues((current) => ({
        ...current,
        [updatedItem.id]: {
          itemName: updatedItem.identification.itemName,
          manualMaxPrice:
            updatedItem.manualMaxPrice === null ? "" : String(updatedItem.manualMaxPrice),
          offerPrice: updatedItem.offerPrice === null ? "" : String(updatedItem.offerPrice),
        },
      }));
    } catch (err) {
      if (err instanceof Error) {
        void reportClientError({
          source: "appointment.detail.inline_save",
          message: err.message,
          errorName: err.name,
          stack: err.stack || null,
          metadata: {
            appointmentId,
            itemId: item.id,
          },
        });
      }
      setError(err instanceof Error ? err.message : "明細の保存に失敗しました");
    } finally {
      setUpdatingItemId(null);
    }
  }

  async function handleAppendItemImage(
    item: AppraisalHistoryItem,
    event: ChangeEvent<HTMLInputElement>
  ) {
    const files = Array.from(event.target.files || []);
    event.currentTarget.value = "";
    if (files.length === 0) {
      return;
    }

    setImageUploadingItemId(item.id);
    setError(null);
    setErrorReference(null);

    try {
      const clientSessionId =
        clientSessionIdRef.current || getOrCreateClientSessionId();
      clientSessionIdRef.current = clientSessionId;
      const formData = new FormData();
      formData.append("itemId", item.id);
      files.forEach((file, index) => {
        formData.append("images", file);
        formData.append("imageSlotLabels", `追加写真${item.images.length + index + 1}`);
      });

      const response = await fetch("/api/history", {
        method: "POST",
        headers: clientSessionId ? { "x-client-session-id": clientSessionId } : undefined,
        body: formData,
      });
      const payload = await response.json();

      if (!response.ok) {
        const message = payload.error || "写真の追加に失敗しました";
        if (typeof payload.errorId === "string") {
          setErrorReference(payload.errorId);
        }
        throw new Error(message);
      }

      const updatedItem = payload.item as AppraisalHistoryItem;
      setItems((current) =>
        current.map((candidate) =>
          candidate.id === updatedItem.id ? updatedItem : candidate
        )
      );
    } catch (err) {
      if (err instanceof Error) {
        void reportClientError({
          source: "appointment.detail.image_append",
          message: err.message,
          errorName: err.name,
          stack: err.stack || null,
          metadata: {
            appointmentId,
            itemId: item.id,
          },
        });
      }
      setError(err instanceof Error ? err.message : "写真の追加に失敗しました");
    } finally {
      setImageUploadingItemId(null);
    }
  }

  const itemCount = appointmentGroup?.itemCount || 0;
  const totalItemCount = appointmentGroup?.totalItemCount || 0;
  const excludedItemCount = appointmentGroup?.excludedItemCount || 0;
  const totalSuggestedMaxPrice = appointmentGroup?.totalSuggestedMaxPrice || 0;
  const totalOfferPrice = appointmentGroup?.totalOfferPrice || 0;
  const totalContractedSuggestedMaxPrice =
    appointmentGroup?.totalContractedSuggestedMaxPrice || 0;
  const totalContractedOfferPrice = appointmentGroup?.totalContractedOfferPrice || 0;
  const totalContractedGrossProfit = appointmentGroup?.totalContractedGrossProfit || 0;
  const latestAppraisalAt = appointmentGroup?.latestAppraisalAt || null;
  const displayedItems = items.filter((item) => {
    if (itemFilter === "contracted") {
      return item.isContracted;
    }
    if (itemFilter === "open") {
      return !item.isContracted;
    }
    return true;
  });

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
                ? `${formatDateTime(latestAppraisalAt)} · 対象${itemCount}件 / 全${totalItemCount}件`
                : "まだ査定は保存されていません"}
              {excludedItemCount > 0 ? ` · 除外${excludedItemCount}件` : ""}
            </p>
          </div>
          <div className={styles.heroSummaryGrid}>
            <div className={styles.heroSummary}>
              <span className={styles.heroSummaryLabel}>Max価格合計</span>
              <span className={styles.heroSummaryValue}>
                {formatCurrency(totalSuggestedMaxPrice)}
              </span>
            </div>
            <div className={styles.heroSummary}>
              <span className={styles.heroSummaryLabel}>オファー合計</span>
              <span className={styles.heroSummaryValue}>
                {formatCurrency(totalOfferPrice)}
              </span>
            </div>
            <div className={styles.heroSummary}>
              <span className={styles.heroSummaryLabel}>成約Max価格合計</span>
              <span className={styles.heroSummaryValue}>
                {formatCurrency(totalContractedSuggestedMaxPrice)}
              </span>
            </div>
            <div className={styles.heroSummary}>
              <span className={styles.heroSummaryLabel}>成約価格合計</span>
              <span className={styles.heroSummaryValue}>
                {formatCurrency(totalContractedOfferPrice)}
              </span>
            </div>
            <div className={`${styles.heroSummary} ${styles.profitSummary}`}>
              <span className={styles.heroSummaryLabel}>粗利</span>
              <span className={styles.heroSummaryValue}>
                {formatCurrency(totalContractedGrossProfit)}
              </span>
            </div>
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

        <section className={styles.manualSection}>
          <div className={styles.sectionHeader}>
            <div>
              <h2 className={styles.sectionTitle}>手動入力で追加</h2>
              <p className={styles.sectionCaption}>
                自動査定が使えない時は、品目名と査定価格だけをこのアポに保存できます。
              </p>
            </div>
          </div>
          <form className={styles.manualForm} onSubmit={handleManualSubmit}>
            <input
              type="text"
              value={manualItemName}
              onChange={(event) => setManualItemName(event.target.value)}
              className={styles.manualInput}
              placeholder="例: Rolex Air-King"
            />
            <input
              type="number"
              min="1"
              step="1"
              inputMode="decimal"
              value={manualPriceUsd}
              onChange={(event) => setManualPriceUsd(event.target.value)}
              className={styles.manualPriceInput}
              placeholder="価格 USD"
            />
            <label className={styles.manualPhotoButton}>
              写真を追加
              <input
                ref={manualPhotoInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className={styles.fileInput}
                onChange={handleManualPhotoChange}
              />
            </label>
            <button
              type="submit"
              className={styles.manualButton}
              disabled={isManualSaving}
            >
              {isManualSaving ? "保存中..." : "手動保存"}
            </button>
          </form>
          {manualPriceUsd && Number.isFinite(Number(manualPriceUsd)) && (
            <p className={styles.manualHelp}>
              円換算目安: {formatYenFromUsd(Number(manualPriceUsd))}（1USD={USD_TO_JPY_RATE}円）
            </p>
          )}
          {manualPhoto && (
            <div className={styles.manualPhotoPreviewRow}>
              <img
                src={manualPhoto.url}
                alt="手動入力写真"
                className={styles.manualPhotoPreview}
              />
              <button
                type="button"
                className={styles.manualPhotoRemoveButton}
                onClick={removeManualPhoto}
              >
                写真を外す
              </button>
            </div>
          )}
          {manualError && <p className={styles.messageError}>{manualError}</p>}
          {manualSuccess && <p className={styles.messageSuccess}>{manualSuccess}</p>}
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
            <span className={styles.sectionCount}>
              対象{itemCount}件 / 全{totalItemCount}件
            </span>
          </div>
          <div className={styles.filterTabs}>
            <button
              type="button"
              className={itemFilter === "all" ? styles.filterTabActive : styles.filterTab}
              onClick={() => setItemFilter("all")}
            >
              すべて
            </button>
            <button
              type="button"
              className={
                itemFilter === "contracted" ? styles.filterTabActive : styles.filterTab
              }
              onClick={() => setItemFilter("contracted")}
            >
              成約済み
            </button>
            <button
              type="button"
              className={itemFilter === "open" ? styles.filterTabActive : styles.filterTab}
              onClick={() => setItemFilter("open")}
            >
              未成約
            </button>
          </div>

          {isLoading ? (
            <p className={styles.messageMuted}>読み込んでいます...</p>
          ) : items.length === 0 ? (
            <p className={styles.messageMuted}>
              まだこのアポに保存された査定はありません。査定画面から写真を送ると、このページにまとまって表示されます。
            </p>
          ) : (
            <div className={styles.itemGrid}>
              {displayedItems.map((item) => {
                const editValues = inlineEditValues[item.id] || {
                  itemName: item.identification.itemName,
                  manualMaxPrice:
                    item.manualMaxPrice === null ? "" : String(item.manualMaxPrice),
                  offerPrice: item.offerPrice === null ? "" : String(item.offerPrice),
                };

                return (
                <article
                  key={item.id}
                  className={`${styles.itemCard} ${
                    item.isExcluded ? styles.itemCardExcluded : ""
                  }`}
                >
                  <div className={styles.itemImages}>
                    {item.images.length > 0 ? (
                      item.images.map((image) => (
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
                              item.isExcluded ? styles.imageExcluded : ""
                            }`}
                          />
                          <span className={styles.imageBadge}>{image.slotLabel}</span>
                        </a>
                      ))
                    ) : (
                      <div className={styles.manualImagePlaceholder}>
                        {isManualHistoryItem(item) ? "手動入力" : "画像保存中"}
                      </div>
                    )}
                  </div>

                  <div className={styles.itemBody}>
                    <div className={styles.itemTop}>
                      <Link href={`/appraisals/${item.id}`} className={styles.itemDetailLink}>
                        <h3 className={styles.itemName}>{item.identification.itemName}</h3>
                      </Link>
                      <div className={styles.itemPriceBlock}>
                        <span className={styles.itemPrice}>
                          {formatCurrency(getEffectiveMaxPrice(item))}
                        </span>
                        {item.conditionRank ? (
                          <span className={styles.itemPriceBadge}>
                            {getConditionRankLabel(item.conditionRank)}
                          </span>
                        ) : item.manualMaxPrice !== null ? (
                          <span className={styles.itemPriceBadge}>手動Max</span>
                        ) : null}
                        {item.conditionRank && (
                          <span className={styles.itemPriceSub}>
                            中央値 {formatCurrency(item.pricing.median)}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className={styles.inlineEditGrid}>
                      <label>
                        品名
                        <input
                          type="text"
                          value={editValues.itemName}
                          onChange={(event) =>
                            updateInlineEditValue(item, "itemName", event.target.value)
                          }
                        />
                      </label>
                      <label>
                        MAX USD
                        <input
                          type="number"
                          min="0"
                          step="1"
                          inputMode="decimal"
                          value={editValues.manualMaxPrice}
                          onChange={(event) =>
                            updateInlineEditValue(
                              item,
                              "manualMaxPrice",
                              event.target.value
                            )
                          }
                          placeholder={String(getEffectiveMaxPrice(item))}
                        />
                      </label>
                      <label>
                        オファー USD
                        <input
                          type="number"
                          min="0"
                          step="1"
                          inputMode="decimal"
                          value={editValues.offerPrice}
                          onChange={(event) =>
                            updateInlineEditValue(item, "offerPrice", event.target.value)
                          }
                        />
                      </label>
                    </div>
                    <p className={styles.yenHint}>
                      MAX円換算 {formatYenFromUsd(getEffectiveMaxPrice(item))} / オファー円換算{" "}
                      {formatYenFromUsd(item.offerPrice)}
                    </p>
                    <p className={styles.itemMeta}>
                      {formatDateTime(item.createdAt)}
                      {" · "}
                      {isManualHistoryItem(item)
                        ? "手動入力"
                        : item.identification.brand || item.identification.category}
                    </p>
                    <p className={styles.itemPriceRow}>
                      {isManualHistoryItem(item)
                        ? "手動入力価格"
                        : `買取目安 ${formatCurrency(
                            item.pricing.buyPriceRangeLow
                          )} – ${formatCurrency(item.pricing.buyPriceRangeHigh)} · ${
                            item.pricing.listingCount
                          }件参照`}
                      {item.manualMaxPrice !== null && !item.conditionRank
                        ? ` · 査定Max ${formatCurrency(item.pricing.suggestedMaxPrice)}`
                        : ""}
                    </p>
                    <div className={styles.itemSettlementRow}>
                      <span>オファー {formatCurrency(item.offerPrice)}</span>
                      <label className={styles.contractCheckboxLabel}>
                        <input
                          type="checkbox"
                          checked={item.isContracted}
                          onChange={() => void handleToggleContracted(item)}
                          disabled={updatingItemId === item.id || item.isExcluded}
                        />
                        <span>{item.isContracted ? "成約済み" : "未成約"}</span>
                      </label>
                    </div>
                    <div className={styles.itemActionRow}>
                      <button
                        type="button"
                        className={styles.saveInlineButton}
                        onClick={() => void handleInlineSave(item)}
                        disabled={updatingItemId === item.id}
                      >
                        {updatingItemId === item.id ? "保存中..." : "明細保存"}
                      </button>
                      <label className={styles.addImageButton}>
                        {imageUploadingItemId === item.id ? "追加中..." : "写真追加"}
                        <input
                          type="file"
                          accept="image/*"
                          multiple
                          capture="environment"
                          className={styles.fileInput}
                          onChange={(event) => void handleAppendItemImage(item, event)}
                          disabled={imageUploadingItemId === item.id}
                        />
                      </label>
                      <Link href={`/appraisals/${item.id}`} className={styles.detailButton}>
                        詳細・価格入力
                      </Link>
                      <button
                        type="button"
                        className={item.isExcluded ? styles.restoreButton : styles.excludeButton}
                        onClick={() => void handleToggleExcluded(item)}
                        disabled={updatingItemId === item.id}
                      >
                        {updatingItemId === item.id
                          ? "更新中..."
                          : item.isExcluded
                            ? "除外解除"
                            : "除外"}
                      </button>
                    </div>
                    {item.isExcluded && (
                      <p className={styles.excludedNote}>この品物は合計から除外中です。</p>
                    )}
                  </div>
                </article>
                );
              })}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
