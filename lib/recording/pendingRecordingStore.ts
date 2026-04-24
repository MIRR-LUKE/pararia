"use client";

export type PendingRecordingMode = "INTERVIEW";
export type PendingRecordingLessonPart = "FULL" | "TEXT_NOTE";

const DB_NAME = "pararia-recording-backup";
const DB_VERSION = 1;
const STORE_NAME = "drafts";

export type PendingRecordingDraftRecord = {
  key: string;
  studentId: string;
  mode: PendingRecordingMode;
  lessonPart: PendingRecordingLessonPart;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  durationSeconds: number | null;
  createdAt: string;
  updatedAt: string;
  blob: Blob;
};

type PendingRecordingDraftInput = {
  studentId: string;
  mode: PendingRecordingMode;
  lessonPart: PendingRecordingLessonPart;
  file: File;
  durationSeconds: number | null;
};

export function buildPendingRecordingDraftKey(
  studentId: string,
  mode: PendingRecordingMode,
  lessonPart: PendingRecordingLessonPart
) {
  return `${studentId}:${mode}:${lessonPart}`;
}

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB を開けませんでした。"));
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => Promise<T>
) {
  const db = await openDatabase();
  try {
    const tx = db.transaction(STORE_NAME, mode);
    const store = tx.objectStore(STORE_NAME);
    const result = await run(store);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("IndexedDB の保存に失敗しました。"));
      tx.onabort = () => reject(tx.error ?? new Error("IndexedDB の処理が中断されました。"));
    });
    return result;
  } finally {
    db.close();
  }
}

function requestAsPromise<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB の読み書きに失敗しました。"));
  });
}

export async function savePendingRecordingDraft(
  input: PendingRecordingDraftInput
) {
  const now = new Date().toISOString();
  const record: PendingRecordingDraftRecord = {
    key: buildPendingRecordingDraftKey(input.studentId, input.mode, input.lessonPart),
    studentId: input.studentId,
    mode: input.mode,
    lessonPart: input.lessonPart,
    fileName: input.file.name,
    mimeType: input.file.type || "audio/webm",
    sizeBytes: input.file.size,
    durationSeconds: input.durationSeconds,
    createdAt: now,
    updatedAt: now,
    blob: input.file,
  };

  return withStore("readwrite", async (store) => {
    await requestAsPromise(store.put(record));
    return record;
  });
}

export async function loadPendingRecordingDraft(input: {
  studentId: string;
  mode: PendingRecordingMode;
  lessonPart: PendingRecordingLessonPart;
}) {
  const key = buildPendingRecordingDraftKey(input.studentId, input.mode, input.lessonPart);
  return withStore("readonly", async (store) => {
    const record = await requestAsPromise(store.get(key));
    return (record as PendingRecordingDraftRecord | undefined) ?? null;
  });
}

export async function clearPendingRecordingDraft(input: {
  studentId: string;
  mode: PendingRecordingMode;
  lessonPart: PendingRecordingLessonPart;
}) {
  const key = buildPendingRecordingDraftKey(input.studentId, input.mode, input.lessonPart);
  return withStore("readwrite", async (store) => {
    await requestAsPromise(store.delete(key));
  });
}
