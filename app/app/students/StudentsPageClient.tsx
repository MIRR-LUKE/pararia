"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AppHeader } from "@/components/layout/AppHeader";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { buildReportDeliverySummary } from "@/lib/report-delivery";
import styles from "./students.module.css";

type SessionSummary = {
  id: string;
  status: string;
  type: "INTERVIEW" | "LESSON_REPORT";
  sessionDate: string;
  heroStateLabel?: string | null;
  heroOneLiner?: string | null;
  latestSummary?: string | null;
  conversation?: { id: string } | null;
};

type ReportSummary = {
  id: string;
  status: "DRAFT" | "REVIEWED" | "SENT" | string;
  createdAt: string;
  reviewedAt?: string | null;
  sentAt?: string | null;
  deliveryChannel?: string | null;
  sourceLogIds?: string[] | null;
  deliveryEvents?: Array<{
    id?: string;
    eventType: string;
    createdAt: string;
    deliveryChannel?: string | null;
  }>;
};

type StudentRow = {
  id: string;
  name: string;
  nameKana?: string | null;
  grade?: string | null;
  course?: string | null;
  guardianNames?: string | null;
  profileCompleteness: number;
  sessions?: SessionSummary[];
  reports?: ReportSummary[];
  _count?: { sessions: number; reports: number };
};

type ViewKey = "all" | "interview" | "report" | "review" | "share" | "sent";

type StudentsPageClientProps = {
  initialStudents: StudentRow[];
};

function summarize(student: StudentRow) {
  const latestSession = student.sessions?.[0];
  const latestReport = student.reports?.[0] ?? null;
  const latestReportSummary = latestReport ? buildReportDeliverySummary(latestReport) : null;

  if (!latestSession) {
    return {
      state: "未開始",
      oneLiner: "まだ会話データがありません。最初の面談から始められる状態です。",
      nextAction: "最初の面談を始める",
      view: "interview" as const,
    };
  }

  if (latestSession.type === "LESSON_REPORT" && latestSession.status === "COLLECTING") {
    return {
      state: latestSession.heroStateLabel ?? "授業途中",
      oneLiner:
        latestSession.heroOneLiner ?? "授業前の記録だけ保存されています。授業後の記録で 1 セッションが完了します。",
      nextAction: "授業後の記録を入れる",
      view: "report" as const,
    };
  }

  if (latestSession.conversation?.id && !latestReport) {
    return {
      state: latestSession.heroStateLabel ?? "レポート作成待ち",
      oneLiner: latestSession.heroOneLiner ?? latestSession.latestSummary ?? "ログは生成済みです。必要なログを選んで保護者レポートを作れます。",
      nextAction: "ログを選んでレポートを作る",
      view: "report" as const,
    };
  }

  if (latestReportSummary?.deliveryState === "draft") {
    return {
      state: latestReportSummary.deliveryStateLabel,
      oneLiner: latestSession.heroOneLiner ?? latestSession.latestSummary ?? "保護者レポートの確認と共有がまだ残っています。",
      nextAction: "レポートを開く",
      view: "review" as const,
    };
  }

  if (latestReportSummary?.deliveryState === "reviewed") {
    return {
      state: latestReportSummary.deliveryStateLabel,
      oneLiner: latestSession.heroOneLiner ?? latestSession.latestSummary ?? "保護者レポートは共有待ちです。",
      nextAction: "共有を完了する",
      view: "share" as const,
    };
  }

  if (latestReportSummary && ["failed", "bounced"].includes(latestReportSummary.deliveryState)) {
    return {
      state: latestReportSummary.deliveryStateLabel,
      oneLiner: latestSession.heroOneLiner ?? latestSession.latestSummary ?? "保護者共有に失敗しています。再送が必要です。",
      nextAction: "再送を確認",
      view: "share" as const,
    };
  }

  if (latestReportSummary && ["sent", "delivered", "resent", "manual_shared"].includes(latestReportSummary.deliveryState)) {
    return {
      state: latestReportSummary.deliveryStateLabel,
      oneLiner: latestSession.heroOneLiner ?? latestSession.latestSummary ?? "保護者共有は完了しています。",
      nextAction: "生徒詳細を開く",
      view: "sent" as const,
    };
  }

  return {
    state: latestSession.heroStateLabel ?? "更新済み",
    oneLiner:
      latestSession.heroOneLiner ?? latestSession.latestSummary ?? "次の会話に向けた材料が揃っています。",
    nextAction: "生徒詳細を開く",
    view: "all" as const,
  };
}

export default function StudentsPageClient({ initialStudents }: StudentsPageClientProps) {
  const router = useRouter();
  const [students, setStudents] = useState<StudentRow[]>(initialStudents);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [view, setView] = useState<ViewKey>("all");
  const [showCreate, setShowCreate] = useState(false);
  const [newStudent, setNewStudent] = useState({
    name: "",
    nameKana: "",
    grade: "",
    course: "",
    guardianNames: "",
  });
  const [studentToDelete, setStudentToDelete] = useState<StudentRow | null>(null);
  const [isDeletingStudent, setIsDeletingStudent] = useState(false);

  useEffect(() => {
    setStudents(initialStudents);
    setLoading(false);
  }, [initialStudents]);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/students", { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "生徒一覧の取得に失敗しました。");
      setStudents(body.students ?? []);
    } catch (err: any) {
      setError(err?.message ?? "生徒一覧の取得に失敗しました。");
    } finally {
      setLoading(false);
    }
  };

  const rows = useMemo(() => {
    return students.map((student) => {
      const summary = summarize(student);
      return {
        ...student,
        state: summary.state,
        oneLiner: summary.oneLiner,
        nextAction: summary.nextAction,
        href: `/app/students/${student.id}`,
        viewKey: summary.view,
      };
    });
  }, [students]);

  const filtered = useMemo(() => {
    const lowered = deferredQuery.trim().toLowerCase();
    return rows.filter((student) => {
      const matchesView = view === "all" ? true : student.viewKey === view;
      if (!matchesView) return false;
      if (!lowered) return true;
      return [student.name, student.nameKana, student.grade, student.course]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(lowered));
    });
  }, [deferredQuery, rows, view]);

  const createStudent = async () => {
    if (!newStudent.name.trim() || !newStudent.nameKana.trim() || !newStudent.grade.trim()) {
      alert("生徒名、フリガナ、学年は必須です。");
      return;
    }

    const res = await fetch("/api/students", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: newStudent.name.trim(),
        nameKana: newStudent.nameKana.trim(),
        grade: newStudent.grade.trim(),
        course: newStudent.course.trim() || undefined,
        guardianNames: newStudent.guardianNames.trim() || undefined,
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(body?.error ?? "生徒の作成に失敗しました。");
      return;
    }

    setShowCreate(false);
    setNewStudent({ name: "", nameKana: "", grade: "", course: "", guardianNames: "" });
    await refresh();
  };

  const deleteStudent = async () => {
    if (!studentToDelete) return;

    setIsDeletingStudent(true);
    try {
      const res = await fetch(`/api/students/${studentToDelete.id}`, {
        method: "DELETE",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body?.error ?? "生徒の削除に失敗しました。");
      }

      setStudentToDelete(null);
      await refresh();
    } catch (nextError: any) {
      alert(nextError?.message ?? "生徒の削除に失敗しました。");
    } finally {
      setIsDeletingStudent(false);
    }
  };

  return (
    <div className={styles.page}>
      <AppHeader
        title="生徒一覧"
        subtitle="生徒を選んで詳細に入り、録音や確認は生徒ページの中で進めます。"
        actions={
          <Button variant="secondary" onClick={() => setShowCreate((prev) => !prev)}>
            生徒を追加
          </Button>
        }
      />

      <section className={styles.toolbar}>
        <input
          className={styles.search}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="名前、フリガナ、学年、コースで検索"
        />
        <div className={styles.filters}>
          {[
            { key: "all", label: "すべて" },
            { key: "interview", label: "面談待ち" },
            { key: "report", label: "ログあり" },
            { key: "review", label: "レビュー待ち" },
            { key: "share", label: "共有待ち" },
            { key: "sent", label: "送付済み" },
          ].map((item) => (
            <button
              key={item.key}
              type="button"
              className={`${styles.filterChip} ${view === item.key ? styles.filterChipActive : ""}`}
              onClick={() => setView(item.key as ViewKey)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </section>

      {showCreate && (
        <Card title="新しい生徒を追加" subtitle="最小限の情報だけ入れて、あとの理解は会話の中で育てます。">
          <div className={styles.formGrid}>
            <input
              value={newStudent.name}
              onChange={(event) => setNewStudent((prev) => ({ ...prev, name: event.target.value }))}
              placeholder="生徒名"
            />
            <input
              value={newStudent.nameKana}
              onChange={(event) => setNewStudent((prev) => ({ ...prev, nameKana: event.target.value }))}
              placeholder="フリガナ"
            />
            <input
              value={newStudent.grade}
              onChange={(event) => setNewStudent((prev) => ({ ...prev, grade: event.target.value }))}
              placeholder="学年"
            />
            <input
              value={newStudent.course}
              onChange={(event) => setNewStudent((prev) => ({ ...prev, course: event.target.value }))}
              placeholder="コース"
            />
            <input
              value={newStudent.guardianNames}
              onChange={(event) => setNewStudent((prev) => ({ ...prev, guardianNames: event.target.value }))}
              placeholder="保護者名"
            />
          </div>
          <div className={styles.formActions}>
            <Button variant="secondary" onClick={() => setShowCreate(false)}>
              閉じる
            </Button>
            <Button onClick={createStudent}>追加する</Button>
          </div>
        </Card>
      )}

      <Card title="生徒ディレクトリ" subtitle="一覧では状態だけを見て、操作は生徒詳細ページの中で落ち着いて進めます。">
        {error && <div className={styles.error}>{error}</div>}
        {loading ? (
          <div className={styles.empty}>読み込み中です。</div>
        ) : filtered.length === 0 ? (
          <div className={styles.emptyState}>
            <strong>条件に合う生徒がいません</strong>
            <p>検索条件を変えるか、新しい生徒を追加してください。</p>
          </div>
        ) : (
          <div className={styles.list}>
            {filtered.map((student) => (
              <article key={student.id} className={styles.row}>
                <div className={styles.rowContent}>
                  <div className={styles.rowIdentity}>
                    <div className={styles.rowTop}>
                      <strong className={styles.rowName}>{student.name}</strong>
                      {student.grade ? <span className={styles.meta}>{student.grade}</span> : null}
                      <Badge label={student.state} tone={student.viewKey === "report" ? "high" : "medium"} />
                    </div>
                    <p className={styles.oneLiner}>{student.oneLiner}</p>
                  </div>

                  <div className={styles.rowMetaColumn}>
                    <div>
                      <div className={styles.metaLabel}>次にやること</div>
                      <div className={styles.metaValue}>{student.nextAction}</div>
                    </div>
                    <div>
                      <div className={styles.metaLabel}>プロフィール</div>
                      <div className={styles.metaValue}>{student.profileCompleteness}%</div>
                    </div>
                  </div>

                  <div className={styles.rowMetaColumn}>
                    <div>
                      <div className={styles.metaLabel}>セッション</div>
                      <div className={styles.metaValue}>{student._count?.sessions ?? 0} 件</div>
                    </div>
                    <div>
                      <div className={styles.metaLabel}>レポート</div>
                      <div className={styles.metaValue}>{student._count?.reports ?? 0} 件</div>
                    </div>
                  </div>
                </div>

                <div className={styles.rowAction}>
                  <Button onClick={() => router.push(student.href)}>生徒詳細へ</Button>
                  <Button
                    variant="ghost"
                    size="small"
                    className={styles.deleteButton}
                    onClick={() => setStudentToDelete(student)}
                  >
                    削除
                  </Button>
                </div>
              </article>
            ))}
          </div>
        )}
      </Card>

      <ConfirmDialog
        open={Boolean(studentToDelete)}
        title={studentToDelete ? `${studentToDelete.name} を削除しますか？` : ""}
        description="生徒本体に加えて、関連する面談ログ・指導報告ログ・保護者レポートもまとめて削除します。"
        details={[
          "この操作は取り消せません。",
          "削除後は生徒一覧と関連ログ一覧から即時に消えます。",
        ]}
        confirmLabel="削除する"
        cancelLabel="戻る"
        tone="danger"
        pending={isDeletingStudent}
        onConfirm={() => void deleteStudent()}
        onCancel={() => {
          if (isDeletingStudent) return;
          setStudentToDelete(null);
        }}
      />
    </div>
  );
}
