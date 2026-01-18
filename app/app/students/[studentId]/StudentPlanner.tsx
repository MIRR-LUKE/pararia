"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./studentDetail.module.css";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";

type PlanItem = {
  id?: string;
  date: string; // 開始日
  endDate?: string; // 終了日（任意）
  title: string;
  status: "planned" | "done" | "pending";
  category: string;
  description?: string;
  isEvent?: boolean;
};

type Props = {
  items: PlanItem[];
};

export function StudentPlanner({ items }: Props) {
  const normalize = (list: PlanItem[]) =>
    list.map((p, idx) => ({
      ...p,
      id: p.id ?? `${p.date}-${p.title}-${idx}-${Math.random().toString(16).slice(2, 6)}`,
    }));

  const [plans, setPlans] = useState<PlanItem[]>(normalize(items));
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [status, setStatus] = useState<PlanItem["status"]>("planned");
  const [category, setCategory] = useState("study");
  const [detailItem, setDetailItem] = useState<PlanItem | null>(null);
  const [createDate, setCreateDate] = useState<string>("");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  useEffect(() => {
    const normalized = normalize(items);
    setPlans(normalized);
    setViewDate(normalized[0] ? new Date(normalized[0].date) : new Date());
  }, [items]);

  const initialDate = useMemo(
    () => (items[0] ? new Date(items[0].date) : new Date()),
    [items]
  );
  const [viewDate, setViewDate] = useState<Date>(initialDate);

  const monthLabel = useMemo(
    () => `${viewDate.getFullYear()}年 ${viewDate.getMonth() + 1}月`,
    [viewDate]
  );

  const expandRange = (item: PlanItem) => {
    const start = new Date(item.date);
    const end = item.endDate ? new Date(item.endDate) : new Date(item.date);
    const dates: string[] = [];
    for (
      let d = new Date(start);
      d <= end;
      d.setDate(d.getDate() + 1)
    ) {
      dates.push(new Date(d).toISOString().slice(0, 10));
    }
    return dates;
  };

  const days = useMemo(() => {
    const start = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1);
    const end = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 0);
    const arr: { date: Date; events: PlanItem[] }[] = [];
    for (let d = 1; d <= end.getDate(); d++) {
      const current = new Date(viewDate.getFullYear(), viewDate.getMonth(), d);
      const iso = current.toISOString().slice(0, 10);
      arr.push({
        date: current,
        events: plans.filter((p) => expandRange(p).includes(iso)),
      });
    }
    return arr;
  }, [viewDate, plans]);

  const addPlan = () => {
    if (!title || !date) return;
    const newItem: PlanItem = {
      id: editingId ?? `plan-${Date.now()}`,
      title,
      date,
      endDate: endDate || undefined,
      status,
      category: category || "study",
    };
    setPlans((prev) =>
      editingId ? prev.map((p) => (p.id === editingId ? newItem : p)) : [...prev, newItem]
    );
    setTitle("");
    setDate("");
    setEndDate("");
    setEditingId(null);
    setShowCreateModal(false);
  };

  const statusTone = (s: PlanItem["status"]) => {
    if (s === "done") return "low";
    if (s === "pending") return "medium";
    return "neutral";
  };

  const categoryColor = (c: string) => {
    if (c.startsWith("event-exam")) return { bg: "#fee2e2", color: "#991b1b" };
    if (c.startsWith("event-school")) return { bg: "#e0f2fe", color: "#075985" };
    if (c.startsWith("event-club")) return { bg: "#f5f3ff", color: "#6d28d9" };
    if (c.startsWith("event-family") || c.startsWith("event-life"))
      return { bg: "#ecfccb", color: "#365314" };
    if (c === "math") return { bg: "#e0f2fe", color: "#0f172a" };
    if (c === "english") return { bg: "#f3e8ff", color: "#6b21a8" };
    if (c === "history") return { bg: "#fff7ed", color: "#9a3412" };
    return { bg: "#f1f5f9", color: "#0f172a" };
  };

  const goPrevMonth = () => {
    setViewDate(
      (prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1)
    );
  };

  const goNextMonth = () => {
    setViewDate(
      (prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1)
    );
  };

  return (
    <div className={styles.plannerGrid}>
      <div className={styles.calendar}>
        <div className={styles.calendarHeader}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button className={styles.navButton} type="button" onClick={goPrevMonth}>
              ←
            </button>
            <div style={{ fontWeight: 800 }}>{monthLabel}</div>
            <button className={styles.navButton} type="button" onClick={goNextMonth}>
              →
            </button>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <Badge label="勉強計画" />
            <Badge label="行事" tone="medium" />
          </div>
        </div>
        <div className={styles.calendarGrid}>
          {days.map((day) => {
            const isoDay = day.date.toISOString().slice(0, 10);
            return (
              <div
                key={isoDay}
                className={styles.day}
                onClick={() => {
                  setCreateDate(isoDay);
                  setDate(isoDay);
                  setEndDate(isoDay);
                  setEditingId(null);
                  setShowCreateModal(true);
                }}
              >
                <div className={styles.dayLabel}>{day.date.getDate()}</div>
                <div className={styles.dayEvents}>
                  {day.events.map((ev, idx) => {
                    const { bg, color } = categoryColor(ev.category);
                    const label =
                      ev.title.length > 16 ? `${ev.title.slice(0, 16)}…` : ev.title;
                    const isStart = ev.date === isoDay;
                    const isEnd = (ev.endDate ?? ev.date) === isoDay;
                    const spanClass =
                      isStart && isEnd
                        ? ""
                        : isStart
                        ? styles.rangeStart
                        : isEnd
                        ? styles.rangeEnd
                        : styles.rangeMiddle;
                    return (
                      <button
                        type="button"
                        key={`${ev.id ?? ev.title}-${idx}-${isoDay}`}
                        className={`${styles.eventBadge} ${spanClass}`}
                        style={{
                          background: bg,
                          color,
                          borderColor: "transparent",
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          setDetailItem(ev);
                          setShowDetailModal(true);
                        }}
                        title={ev.title}
                      >
                        <span className={styles.eventText}>{label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {showDetailModal && detailItem && (
        <div className={styles.overlay} onClick={() => setShowDetailModal(false)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <div>
                <div className={styles.detailTitle}>{detailItem.title}</div>
                <div className={styles.subtext}>
                  {detailItem.date}
                  {detailItem.endDate && detailItem.endDate !== detailItem.date
                    ? ` 〜 ${detailItem.endDate}`
                    : ""}
                </div>
              </div>
              <Button size="small" variant="ghost" onClick={() => setShowDetailModal(false)}>
                閉じる
              </Button>
            </div>
            <div className={styles.detailMeta}>
              <span>カテゴリ</span>
              <span className={styles.pill}>{detailItem.category}</span>
            </div>
            <div className={styles.detailMeta}>
              <span>ステータス</span>
              <Badge label={detailItem.status.toUpperCase()} tone={statusTone(detailItem.status)} />
            </div>
            {detailItem.description && (
              <div className={styles.detailMeta} style={{ alignItems: "flex-start" }}>
                <span>メモ</span>
                <span className={styles.detailNote}>{detailItem.description}</span>
              </div>
            )}
            <div style={{ display: "flex", gap: 8 }}>
              <Button
                size="small"
                variant="primary"
                onClick={() => {
                  setShowDetailModal(false);
                  setShowCreateModal(true);
                  setEditingId(detailItem.id ?? null);
                  setTitle(detailItem.title);
                  setDate(detailItem.date);
                  setEndDate(detailItem.endDate ?? detailItem.date);
                  setStatus(detailItem.status);
                  setCategory(detailItem.category);
                }}
              >
                編集
              </Button>
              <Button
                size="small"
                variant="secondary"
                onClick={() => {
                  setPlans((prev) => prev.filter((p) => p.id !== detailItem.id));
                  setShowDetailModal(false);
                }}
              >
                削除
              </Button>
            </div>
          </div>
        </div>
      )}

      {showCreateModal && (
        <div className={styles.overlay} onClick={() => setShowCreateModal(false)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <div>
                <div className={styles.detailTitle}>新しい予定を追加</div>
                <div className={styles.subtext}>{createDate || "日付を選択"}</div>
              </div>
              <Button size="small" variant="ghost" onClick={() => setShowCreateModal(false)}>
                閉じる
              </Button>
            </div>
            <div style={{ display: "grid", gap: 10 }}>
              <input
                className={styles.input}
                placeholder="タイトル（例：図形ドリル10分）"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
              <div style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr 1fr" }}>
                <input
                  className={styles.input}
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
                <input
                  className={styles.input}
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <select
                  className={styles.select}
                  value={status}
                  onChange={(e) => setStatus(e.target.value as PlanItem["status"])}
                >
                  <option value="planned">予定</option>
                  <option value="pending">要フォロー</option>
                  <option value="done">完了</option>
                </select>
                <input
                  className={styles.input}
                  placeholder="カテゴリ（math, english, event-examなど）"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                />
              </div>
              <Button variant="primary" size="small" onClick={addPlan}>
                {editingId ? "更新する" : "追加する"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
