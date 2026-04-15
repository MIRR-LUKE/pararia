"use client";

import { useEffect, useMemo, useState } from "react";
import { createStudentEditorDraft, type StudentEditorDraft } from "../studentEditorDraft";
import type { RoomResponse } from "./roomTypes";

type Props = {
  initialStudent: RoomResponse["student"];
  studentId: string;
  refresh: () => Promise<void>;
};

export function useStudentDetailEditor({ initialStudent, studentId, refresh }: Props) {
  const [isEditingStudent, setIsEditingStudent] = useState(false);
  const [studentDraft, setStudentDraft] = useState<StudentEditorDraft>(() =>
    createStudentEditorDraft(initialStudent)
  );
  const [isSavingStudent, setIsSavingStudent] = useState(false);
  const [studentSaveMessage, setStudentSaveMessage] = useState<string | null>(null);

  const studentDraftFromRoom = useMemo(() => createStudentEditorDraft(initialStudent), [initialStudent]);
  const studentDraftChanged =
    studentDraft.name !== studentDraftFromRoom.name ||
    studentDraft.nameKana !== studentDraftFromRoom.nameKana ||
    studentDraft.grade !== studentDraftFromRoom.grade ||
    studentDraft.course !== studentDraftFromRoom.course ||
    studentDraft.guardianNames !== studentDraftFromRoom.guardianNames;

  useEffect(() => {
    if (!isEditingStudent) {
      setStudentDraft(studentDraftFromRoom);
    }
  }, [isEditingStudent, studentDraftFromRoom]);

  const openEditor = () => {
    setIsEditingStudent(true);
  };

  const closeEditor = () => {
    setStudentDraft(studentDraftFromRoom);
    setIsEditingStudent(false);
    setStudentSaveMessage(null);
  };

  const handleStudentSave = async () => {
    setIsSavingStudent(true);
    setStudentSaveMessage(null);

    try {
      const res = await fetch(`/api/students/${studentId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
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

      await refresh();
      setIsEditingStudent(false);
      setStudentSaveMessage("生徒情報を更新しました。");
    } catch (nextError: any) {
      setStudentSaveMessage(nextError?.message ?? "生徒情報の更新に失敗しました。");
    } finally {
      setIsSavingStudent(false);
    }
  };

  return {
    closeEditor,
    handleStudentSave,
    isEditingStudent,
    isSavingStudent,
    openEditor,
    setStudentDraft,
    studentDraft,
    studentDraftChanged,
    studentDraftFromRoom,
    studentSaveMessage,
  };
}
