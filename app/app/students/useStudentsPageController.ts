"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import type { StudentDirectoryViewRow } from "@/lib/students/student-directory-view";
import {
  createStudentEditorDraft,
  normalizeStudentNameKey,
  type StudentEditorDraft,
} from "./studentEditorDraft";

type ViewKey = "all" | "interview" | "report" | "review" | "share" | "sent";

type StudentNotice =
  | { tone: "success"; text: string }
  | { tone: "error"; text: string }
  | null;

type NewStudentDraft = StudentEditorDraft;

type Props = {
  initialStudents: StudentDirectoryViewRow[];
  initialLimit: number;
};

export function useStudentsPageController({ initialStudents, initialLimit }: Props) {
  const [students, setStudents] = useState<StudentDirectoryViewRow[]>(initialStudents);
  const [loading, setLoading] = useState(initialStudents.length === 0);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [view, setView] = useState<ViewKey>("all");
  const [showCreate, setShowCreate] = useState(false);
  const [newStudent, setNewStudent] = useState<NewStudentDraft>({
    name: "",
    nameKana: "",
    grade: "",
    course: "",
    guardianNames: "",
  });
  const [editingStudentId, setEditingStudentId] = useState<string | null>(null);
  const [studentDraft, setStudentDraft] = useState<StudentEditorDraft>({
    name: "",
    nameKana: "",
    grade: "",
    course: "",
    guardianNames: "",
  });
  const [isSavingStudent, setIsSavingStudent] = useState(false);
  const [studentNotice, setStudentNotice] = useState<StudentNotice>(null);
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
  const duplicateCountByName = useMemo(() => {
    const counts = new Map<string, number>();
    for (const student of rows) {
      const key = normalizeStudentNameKey(student.name);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [rows]);

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

  const editingStudent = useMemo(
    () => rows.find((student) => student.id === editingStudentId) ?? null,
    [editingStudentId, rows]
  );
  const studentDraftFromRow = useMemo(
    () => (editingStudent ? createStudentEditorDraft(editingStudent) : null),
    [editingStudent]
  );
  const studentDraftChanged =
    studentDraftFromRow !== null &&
    (studentDraft.name !== studentDraftFromRow.name ||
      studentDraft.nameKana !== studentDraftFromRow.nameKana ||
      studentDraft.grade !== studentDraftFromRow.grade ||
      studentDraft.course !== studentDraftFromRow.course ||
      studentDraft.guardianNames !== studentDraftFromRow.guardianNames);

  const openInlineEditor = useCallback(
    (student: StudentDirectoryViewRow) => {
      if (editingStudentId === student.id) {
        setEditingStudentId(null);
        setStudentDraft({ name: "", nameKana: "", grade: "", course: "", guardianNames: "" });
        setStudentNotice(null);
        return;
      }

      setEditingStudentId(student.id);
      setStudentDraft(createStudentEditorDraft(student));
      setStudentNotice(null);
    },
    [editingStudentId]
  );

  const closeInlineEditor = useCallback(() => {
    setEditingStudentId(null);
    setStudentDraft({ name: "", nameKana: "", grade: "", course: "", guardianNames: "" });
    setStudentNotice(null);
  }, []);

  const saveInlineStudent = useCallback(async () => {
    if (!editingStudentId) return;

    setIsSavingStudent(true);
    setStudentNotice(null);

    try {
      const res = await fetch(`/api/students/${editingStudentId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: studentDraft.name,
          nameKana: studentDraft.nameKana,
          grade: studentDraft.grade,
          course: studentDraft.course,
          guardianNames: studentDraft.guardianNames,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body?.error ?? "生徒情報の更新に失敗しました。");
      }

      setStudentNotice({ tone: "success", text: "生徒情報を更新しました。" });
      setEditingStudentId(null);
      await refresh();
    } catch (nextError: any) {
      setStudentNotice({
        tone: "error",
        text: nextError?.message ?? "生徒情報の更新に失敗しました。",
      });
    } finally {
      setIsSavingStudent(false);
    }
  }, [editingStudentId, refresh, studentDraft]);

  const createStudent = useCallback(async () => {
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

    setStudentNotice({ tone: "success", text: "生徒を追加しました。" });
    setShowCreate(false);
    setNewStudent({ name: "", nameKana: "", grade: "", course: "", guardianNames: "" });
    await refresh();
  }, [newStudent, refresh]);

  const archiveStudent = useCallback(async () => {
    if (!studentToDelete) return;

    const targetStudentId = studentToDelete.id;
    setIsDeletingStudent(true);
    try {
      const res = await fetch(`/api/students/${studentToDelete.id}`, {
        method: "DELETE",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body?.error ?? "生徒のアーカイブに失敗しました。");
      }

      setStudents((current) => current.filter((item) => item.id !== studentToDelete.id));
      setStudentToDelete(null);
      if (editingStudentId === targetStudentId) {
        closeInlineEditor();
      }
      setStudentNotice({ tone: "success", text: "生徒をアーカイブしました。" });
      await refresh();
    } catch (nextError: any) {
      setStudentNotice({
        tone: "error",
        text: nextError?.message ?? "生徒のアーカイブに失敗しました。",
      });
    } finally {
      setIsDeletingStudent(false);
    }
  }, [closeInlineEditor, editingStudentId, refresh, studentToDelete]);

  return {
    archiveStudent,
    canShowCreateAction: !showCreate,
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
    rows,
    setNewStudent,
    setQuery,
    setShowCreate,
    setStudentDraft,
    setStudentNotice,
    setStudentToDelete,
    setView,
    showCreate,
    saveInlineStudent,
    studentDraft,
    studentDraftChanged,
    studentNotice,
    studentToDelete,
    view,
  };
}
