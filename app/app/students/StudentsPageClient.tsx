"use client";

import { AppHeader } from "@/components/layout/AppHeader";
import { Button } from "@/components/ui/Button";
import type { StudentDirectoryViewRow } from "@/lib/students/student-directory-view";
import { StudentsCreateSection, StudentsDeleteDialog, StudentsDirectorySection, StudentsToolbarSection } from "./StudentsPageSections";
import { useStudentsPageController } from "./useStudentsPageController";
import styles from "./students.module.css";

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
  const {
    archiveStudent,
    canShowCreateAction,
    closeInlineEditor,
    createStudent,
    duplicateCountByName,
    editingStudentId,
    error,
    filtered,
    isDeletingStudent,
    isSavingStudent,
    loading,
    newStudent,
    openInlineEditor,
    query,
    refresh,
    setNewStudent,
    setQuery,
    setShowCreate,
    setStudentDraft,
    setStudentToDelete,
    setView,
    showCreate,
    saveInlineStudent,
    studentDraft,
    studentDraftChanged,
    studentNotice,
    studentToDelete,
    view,
  } = useStudentsPageController({ initialStudents, initialLimit });

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

      <StudentsToolbarSection query={query} view={view} onQueryChange={setQuery} onViewChange={setView} />

      <StudentsCreateSection
        canShowCreateAction={canShowCreateAction}
        newStudent={newStudent}
        onClose={() => setShowCreate(false)}
        onCreate={() => void createStudent()}
        onFieldChange={setNewStudent}
        showCreate={showCreate}
      />

      <StudentsDirectorySection
        filtered={filtered}
        duplicateCountByName={duplicateCountByName}
        editingStudentId={editingStudentId}
        studentDraft={studentDraft}
        studentDraftChanged={studentDraftChanged}
        studentNotice={studentNotice}
        studentToDelete={studentToDelete}
        loading={loading}
        error={error}
        canShowCreateAction={canShowCreateAction}
        isDeletingStudent={isDeletingStudent}
        isSavingStudent={isSavingStudent}
        onOpenInlineEditor={openInlineEditor}
        onCloseInlineEditor={closeInlineEditor}
        onStudentDraftChange={setStudentDraft}
        onSaveInlineStudent={() => void saveInlineStudent()}
        onRefresh={() => void refresh()}
        onSetStudentToDelete={setStudentToDelete}
        onOpenCreate={() => setShowCreate(true)}
      />

      <StudentsDeleteDialog
        studentToDelete={studentToDelete}
        isDeletingStudent={isDeletingStudent}
        onConfirm={() => void archiveStudent()}
        onCancel={() => setStudentToDelete(null)}
      />
    </div>
  );
}
