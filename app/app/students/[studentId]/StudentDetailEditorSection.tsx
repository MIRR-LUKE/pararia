"use client";

import { Button } from "@/components/ui/Button";
import type { StudentEditorDraft } from "../studentEditorDraft";
import styles from "./studentDetail.module.css";

type Props = {
  isEditingStudent: boolean;
  isSavingStudent: boolean;
  studentDraft: StudentEditorDraft;
  studentDraftChanged: boolean;
  studentSaveMessage: string | null;
  onOpenEditor: () => void;
  onCloseEditor: () => void;
  onSaveStudent: () => void;
  onDraftChange: (next: StudentEditorDraft) => void;
};

export function StudentDetailEditorSection({
  isEditingStudent,
  isSavingStudent,
  studentDraft,
  studentDraftChanged,
  studentSaveMessage,
  onOpenEditor,
  onCloseEditor,
  onSaveStudent,
  onDraftChange,
}: Props) {
  return (
    <>
      <div className={styles.headingActions}>
        <Button
          variant={isEditingStudent ? "secondary" : "primary"}
          onClick={() => {
            if (isEditingStudent) {
              onCloseEditor();
              return;
            }
            onOpenEditor();
          }}
        >
          {isEditingStudent ? "編集を閉じる" : "生徒情報を編集"}
        </Button>
      </div>

      {isEditingStudent ? (
        <section className={styles.studentEditorPanel}>
          <div className={styles.studentEditorHeader}>
            <div>
              <div className={styles.cardTitle}>生徒情報を編集</div>
              <div className={styles.cardSubtext}>名前、フリガナ、学年、コース、保護者名をここで直せます。</div>
            </div>
          </div>
          <div className={styles.studentEditorGrid}>
            <label className={styles.studentEditorField}>
              <span>生徒名</span>
              <input
                value={studentDraft.name}
                onChange={(event) => onDraftChange({ ...studentDraft, name: event.target.value })}
                placeholder="生徒名"
              />
            </label>
            <label className={styles.studentEditorField}>
              <span>フリガナ</span>
              <input
                value={studentDraft.nameKana}
                onChange={(event) => onDraftChange({ ...studentDraft, nameKana: event.target.value })}
                placeholder="フリガナ"
              />
            </label>
            <label className={styles.studentEditorField}>
              <span>学年</span>
              <input
                value={studentDraft.grade}
                onChange={(event) => onDraftChange({ ...studentDraft, grade: event.target.value })}
                placeholder="学年"
              />
            </label>
            <label className={styles.studentEditorField}>
              <span>コース</span>
              <input
                value={studentDraft.course}
                onChange={(event) => onDraftChange({ ...studentDraft, course: event.target.value })}
                placeholder="コース"
              />
            </label>
            <label className={`${styles.studentEditorField} ${styles.studentEditorFieldWide}`}>
              <span>保護者名</span>
              <input
                value={studentDraft.guardianNames}
                onChange={(event) => onDraftChange({ ...studentDraft, guardianNames: event.target.value })}
                placeholder="保護者名"
              />
            </label>
          </div>
          <div className={styles.studentEditorActions}>
            <Button variant="secondary" onClick={onCloseEditor} disabled={isSavingStudent}>
              キャンセル
            </Button>
            <Button
              onClick={onSaveStudent}
              disabled={isSavingStudent || !studentDraft.name.trim() || !studentDraftChanged}
            >
              {isSavingStudent ? "保存中..." : "生徒情報を更新"}
            </Button>
          </div>
          {studentSaveMessage ? <div className={styles.studentEditorNotice}>{studentSaveMessage}</div> : null}
        </section>
      ) : null}
    </>
  );
}
