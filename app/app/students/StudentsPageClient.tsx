"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import { AppHeader } from "@/components/layout/AppHeader";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { IntentLink } from "@/components/ui/IntentLink";
import { MetricList } from "@/components/ui/MetricList";
import { StatePanel } from "@/components/ui/StatePanel";
import type { StudentDirectoryViewRow } from "@/lib/students/student-directory-view";
import styles from "./students.module.css";

type ViewKey = "all" | "interview" | "report" | "review" | "share" | "sent";

type StudentsPageClientProps = {
  initialStudents: StudentDirectoryViewRow[];
  initialLimit: number;
  viewerName?: string | null;
  viewerRole?: string | null;
};

export default function StudentsPageClient({
  initialStudents,
  initialLimit,
  viewerName,
  viewerRole,
}: StudentsPageClientProps) {
  const [students, setStudents] = useState<StudentDirectoryViewRow[]>(initialStudents);
  const [loading, setLoading] = useState(initialStudents.length === 0);
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
  const [studentToDelete, setStudentToDelete] = useState<StudentDirectoryViewRow | null>(null);
  const [isDeletingStudent, setIsDeletingStudent] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/students?limit=${initialLimit}`, { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "生徒一覧の取得に失敗しました。");
      setStudents(body.students ?? []);
    } catch (err: any) {
      setError(err?.message ?? "生徒一覧の取得に失敗しました。");
    } finally {
      setLoading(false);
    }
  }, [initialLimit]);

  useEffect(() => {
    setStudents(initialStudents);
    if (initialStudents.length > 0) {
      setLoading(false);
      return;
    }
    void refresh();
  }, [initialStudents, refresh]);

  const rows = useMemo(() => students, [students]);
  const canShowCreateAction = !showCreate;

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

  const archiveStudent = async () => {
    if (!studentToDelete) return;

    setIsDeletingStudent(true);
    try {
      const res = await fetch(`/api/students/${studentToDelete.id}`, {
        method: "DELETE",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body?.error ?? "生徒のアーカイブに失敗しました。");
      }

      setStudentToDelete(null);
      await refresh();
    } catch (nextError: any) {
      alert(nextError?.message ?? "生徒のアーカイブに失敗しました。");
    } finally {
      setIsDeletingStudent(false);
    }
  };

  return (
    <div className={styles.page}>
      <AppHeader
        title="生徒一覧"
        subtitle="生徒を選んで詳細に入り、録音や確認は生徒ページの中で進めます。"
        viewerName={viewerName}
        viewerRole={viewerRole}
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
        {error ? (
          <StatePanel
            kind="error"
            compact
            title="生徒一覧を更新できませんでした"
            subtitle={error}
            action={
              <Button variant="secondary" onClick={() => void refresh()}>
                もう一度読む
              </Button>
            }
          />
        ) : loading ? (
          <StatePanel
            kind="processing"
            compact
            title="生徒一覧を更新しています"
            subtitle="必要な生徒だけを先に並べ直しています。"
          />
        ) : filtered.length === 0 ? (
          <StatePanel
            kind="empty"
            title="条件に合う生徒がいません"
            subtitle="検索条件を変えるか、新しい生徒を追加してください。"
            action={
              canShowCreateAction ? (
                <Button variant="secondary" onClick={() => setShowCreate(true)}>
                  生徒を追加
                </Button>
              ) : null
            }
          />
        ) : (
          <div className={styles.list}>
            {filtered.map((student, index) => (
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
                    <MetricList
                      items={[
                        { label: "次にやること", value: student.nextAction },
                        { label: "プロフィール", value: `${student.profileCompleteness}%` },
                      ]}
                    />
                  </div>

                  <div className={styles.rowMetaColumn}>
                    <MetricList
                      items={[
                        { label: "セッション", value: `${student.sessionCount} 件` },
                        { label: "レポート", value: `${student.reportCount} 件` },
                      ]}
                    />
                  </div>
                </div>

                <div className={styles.rowAction}>
                  <IntentLink href={student.href} prefetchMode={index < 4 ? "mount" : "intent"}>
                    <Button>生徒詳細へ</Button>
                  </IntentLink>
                  <Button
                    variant="ghost"
                    size="small"
                    className={styles.deleteButton}
                    onClick={() => setStudentToDelete(student)}
                  >
                    アーカイブ
                  </Button>
                </div>
              </article>
            ))}
          </div>
        )}
      </Card>

      <ConfirmDialog
        open={Boolean(studentToDelete)}
        title={studentToDelete ? `${studentToDelete.name} をアーカイブしますか？` : ""}
        description="一覧からは外れますが、関連する面談ログ・保護者レポートは保持され、管理者が復旧できます。"
        details={[
          "runtime 音声と DB データは保持されます。",
          "一覧・ダッシュボード・通常の導線からは即時に外れます。",
        ]}
        confirmLabel="アーカイブする"
        cancelLabel="戻る"
        tone="danger"
        pending={isDeletingStudent}
        onConfirm={() => void archiveStudent()}
        onCancel={() => {
          if (isDeletingStudent) return;
          setStudentToDelete(null);
        }}
      />
    </div>
  );
}
