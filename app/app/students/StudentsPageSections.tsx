"use client";

import { Fragment } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { IntentLink } from "@/components/ui/IntentLink";
import { MetricList } from "@/components/ui/MetricList";
import { StatePanel } from "@/components/ui/StatePanel";
import type { StudentDirectoryViewRow } from "@/lib/students/student-directory-view";
import { formatStudentCreatedAt, normalizeStudentNameKey, type StudentEditorDraft } from "./studentEditorDraft";
import styles from "./students.module.css";

type ViewKey = "all" | "interview" | "report" | "review" | "share" | "sent";

type StudentNotice =
  | { tone: "success"; text: string }
  | { tone: "error"; text: string }
  | null;

type ToolbarProps = {
  query: string;
  view: ViewKey;
  onQueryChange: (value: string) => void;
  onViewChange: (value: ViewKey) => void;
};

export function StudentsToolbarSection({ query, view, onQueryChange, onViewChange }: ToolbarProps) {
  return (
    <section className={styles.toolbar}>
      <input
        className={styles.search}
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
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
            onClick={() => onViewChange(item.key as ViewKey)}
          >
            {item.label}
          </button>
        ))}
      </div>
    </section>
  );
}

type CreateSectionProps = {
  canShowCreateAction: boolean;
  newStudent: StudentEditorDraft;
  onClose: () => void;
  onCreate: () => void;
  onFieldChange: (next: StudentEditorDraft) => void;
  showCreate: boolean;
};

export function StudentsCreateSection({
  canShowCreateAction,
  newStudent,
  onClose,
  onCreate,
  onFieldChange,
  showCreate,
}: CreateSectionProps) {
  if (!showCreate) return null;

  return (
    <Card title="新しい生徒を追加" subtitle="最小限の情報だけ入れて、あとの理解は会話の中で育てます。">
      <div className={styles.formGrid}>
        <input
          value={newStudent.name}
          onChange={(event) => onFieldChange({ ...newStudent, name: event.target.value })}
          placeholder="生徒名"
        />
        <input
          value={newStudent.nameKana}
          onChange={(event) => onFieldChange({ ...newStudent, nameKana: event.target.value })}
          placeholder="フリガナ"
        />
        <input
          value={newStudent.grade}
          onChange={(event) => onFieldChange({ ...newStudent, grade: event.target.value })}
          placeholder="学年"
        />
        <input
          value={newStudent.course}
          onChange={(event) => onFieldChange({ ...newStudent, course: event.target.value })}
          placeholder="コース"
        />
        <input
          value={newStudent.guardianNames}
          onChange={(event) => onFieldChange({ ...newStudent, guardianNames: event.target.value })}
          placeholder="保護者名"
        />
      </div>
      <div className={styles.formActions}>
        <Button variant="secondary" onClick={onClose}>
          閉じる
        </Button>
        <Button onClick={onCreate}>追加する</Button>
      </div>
      {!canShowCreateAction ? <div className={styles.note}>追加フォームは開いています。</div> : null}
    </Card>
  );
}

type DirectorySectionProps = {
  filtered: StudentDirectoryViewRow[];
  duplicateCountByName: Map<string, number>;
  editingStudentId: string | null;
  studentDraft: StudentEditorDraft;
  studentDraftChanged: boolean;
  studentNotice: StudentNotice;
  studentToDelete: StudentDirectoryViewRow | null;
  loading: boolean;
  error: string | null;
  canShowCreateAction: boolean;
  isDeletingStudent: boolean;
  isSavingStudent: boolean;
  onOpenInlineEditor: (student: StudentDirectoryViewRow) => void;
  onCloseInlineEditor: () => void;
  onStudentDraftChange: (next: StudentEditorDraft) => void;
  onSaveInlineStudent: () => void;
  onRefresh: () => void;
  onSetStudentToDelete: (student: StudentDirectoryViewRow | null) => void;
  onOpenCreate: () => void;
};

export function StudentsDirectorySection({
  filtered,
  duplicateCountByName,
  editingStudentId,
  studentDraft,
  studentDraftChanged,
  studentNotice,
  studentToDelete,
  loading,
  error,
  canShowCreateAction,
  isDeletingStudent,
  isSavingStudent,
  onOpenInlineEditor,
  onCloseInlineEditor,
  onStudentDraftChange,
  onSaveInlineStudent,
  onRefresh,
  onSetStudentToDelete,
  onOpenCreate,
}: DirectorySectionProps) {
  return (
    <Card title="生徒ディレクトリ" subtitle="一覧で確認しながら、その場で直して保存できます。詳しい記録だけ詳細ページで見ます。">
      {studentNotice ? (
        <div
          className={`${styles.notice} ${
            studentNotice.tone === "success" ? styles.noticeSuccess : styles.noticeError
          }`}
        >
          {studentNotice.text}
        </div>
      ) : null}
      {error ? (
        <StatePanel
          kind="error"
          compact
          title="生徒一覧を更新できませんでした"
          subtitle={error}
          action={
            <Button variant="secondary" onClick={onRefresh}>
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
              <Button variant="secondary" onClick={onOpenCreate}>
                生徒を追加
              </Button>
            ) : null
          }
        />
      ) : (
        <div className={styles.list}>
          {filtered.map((student, index) => {
            const isEditingThisStudent = editingStudentId === student.id;

            return (
              <Fragment key={student.id}>
                <article className={styles.row} data-student-row="1" data-student-id={student.id}>
                  <div className={styles.rowContent}>
                    <div className={styles.rowIdentity}>
                      <div className={styles.rowTop}>
                        <strong className={styles.rowName}>{student.name}</strong>
                        {student.grade ? <span className={styles.meta}>{student.grade}</span> : null}
                        {(duplicateCountByName.get(normalizeStudentNameKey(student.name)) ?? 1) > 1 ? (
                          <span className={styles.duplicateBadge}>
                            同名 {duplicateCountByName.get(normalizeStudentNameKey(student.name))}件
                          </span>
                        ) : null}
                        <Badge label={student.state} tone={student.viewKey === "report" ? "high" : "medium"} />
                      </div>
                      <p className={styles.identityMeta}>
                        {[
                          student.nameKana ? `フリガナ: ${student.nameKana}` : null,
                          student.course ? `コース: ${student.course}` : null,
                          student.guardianNames ? `保護者: ${student.guardianNames}` : null,
                          `登録: ${formatStudentCreatedAt(student.createdAt)}`,
                        ]
                          .filter(Boolean)
                          .join(" / ")}
                      </p>
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
                    <div className={styles.rowActionPrimary}>
                      <Button
                        variant="ghost"
                        size="small"
                        className={styles.quickEditButton}
                        aria-expanded={isEditingThisStudent}
                        onClick={() => onOpenInlineEditor(student)}
                      >
                        {isEditingThisStudent ? "閉じる" : "その場で編集"}
                      </Button>
                      <IntentLink href={student.href} prefetchMode={index < 4 ? "mount" : "intent"}>
                        <Button>詳細へ</Button>
                      </IntentLink>
                    </div>
                    <Button
                      variant="ghost"
                      size="small"
                      className={styles.deleteButton}
                      onClick={() => onSetStudentToDelete(student)}
                    >
                      アーカイブ
                    </Button>
                  </div>

                  {isEditingThisStudent ? (
                    <section className={styles.rowEditor} aria-label={`${student.name} の生徒情報を編集`}>
                      <div className={styles.rowEditorHeader}>
                        <div>
                          <div className={styles.rowEditorTitle}>その場で編集</div>
                          <p className={styles.rowEditorText}>
                            名前、フリガナ、学年、コース、保護者名をこの一覧のまま直せます。
                          </p>
                        </div>
                      </div>

                      <div className={styles.rowEditorGrid}>
                        <label className={styles.rowEditorField}>
                          <span>生徒名</span>
                          <input
                            value={studentDraft.name}
                            onChange={(event) => onStudentDraftChange({ ...studentDraft, name: event.target.value })}
                            placeholder="生徒名"
                          />
                        </label>
                        <label className={styles.rowEditorField}>
                          <span>フリガナ</span>
                          <input
                            value={studentDraft.nameKana}
                            onChange={(event) => onStudentDraftChange({ ...studentDraft, nameKana: event.target.value })}
                            placeholder="フリガナ"
                          />
                        </label>
                        <label className={styles.rowEditorField}>
                          <span>学年</span>
                          <input
                            value={studentDraft.grade}
                            onChange={(event) => onStudentDraftChange({ ...studentDraft, grade: event.target.value })}
                            placeholder="学年"
                          />
                        </label>
                        <label className={styles.rowEditorField}>
                          <span>コース</span>
                          <input
                            value={studentDraft.course}
                            onChange={(event) => onStudentDraftChange({ ...studentDraft, course: event.target.value })}
                            placeholder="コース"
                          />
                        </label>
                        <label className={`${styles.rowEditorField} ${styles.rowEditorFieldWide}`}>
                          <span>保護者名</span>
                          <input
                            value={studentDraft.guardianNames}
                            onChange={(event) =>
                              onStudentDraftChange({ ...studentDraft, guardianNames: event.target.value })
                            }
                            placeholder="保護者名"
                          />
                        </label>
                      </div>

                      <div className={styles.rowEditorActions}>
                        <Button variant="secondary" onClick={onCloseInlineEditor} disabled={isSavingStudent}>
                          キャンセル
                        </Button>
                        <Button onClick={onSaveInlineStudent} disabled={isSavingStudent || !studentDraft.name.trim() || !studentDraftChanged}>
                          {isSavingStudent ? "保存中..." : "保存する"}
                        </Button>
                      </div>
                    </section>
                  ) : null}
                </article>
              </Fragment>
            );
          })}
        </div>
      )}
    </Card>
  );
}

type DeleteDialogProps = {
  studentToDelete: StudentDirectoryViewRow | null;
  isDeletingStudent: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function StudentsDeleteDialog({ studentToDelete, isDeletingStudent, onConfirm, onCancel }: DeleteDialogProps) {
  return (
    <ConfirmDialog
      open={Boolean(studentToDelete)}
      title={studentToDelete ? `${studentToDelete.name} をアーカイブしますか？` : ""}
      description="一覧からは外れますが、関連する面談ログと保護者レポートは保持され、管理者が復旧できます。"
      details={[
        "runtime 音声と DB データは保持されます。",
        "一覧・ダッシュボード・通常の導線からは即時に外れます。",
      ]}
      confirmLabel="アーカイブする"
      cancelLabel="戻る"
      tone="danger"
      pending={isDeletingStudent}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
