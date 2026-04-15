"use client";

export type StudentEditorDraft = {
  name: string;
  nameKana: string;
  grade: string;
  course: string;
  guardianNames: string;
};

export type StudentEditorSource = {
  name?: string | null;
  nameKana?: string | null;
  grade?: string | null;
  course?: string | null;
  guardianNames?: string | null;
};

export function createStudentEditorDraft(student: StudentEditorSource): StudentEditorDraft {
  return {
    name: student.name ?? "",
    nameKana: student.nameKana ?? "",
    grade: student.grade ?? "",
    course: student.course ?? "",
    guardianNames: student.guardianNames ?? "",
  };
}

export function normalizeStudentNameKey(value: string) {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
}

export function formatStudentCreatedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "登録日時不明";
  }

  return new Intl.DateTimeFormat("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
