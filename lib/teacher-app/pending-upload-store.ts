"use client";

const DB_NAME = "pararia-teacher-recordings";
const DB_VERSION = 1;
const STORE_NAME = "pending-uploads";

export type PendingTeacherUploadRecord = {
  id: string;
  recordingId: string | null;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  durationSeconds: number | null;
  recordedAt: string;
  updatedAt: string;
  errorMessage: string | null;
  status: "pending" | "failed";
  blob: Blob;
};

type PendingTeacherUploadInput = {
  id: string;
  recordingId: string | null;
  file: File;
  durationSeconds: number | null;
  recordedAt: string;
  errorMessage: string | null;
  status?: "pending" | "failed";
};

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB を開けませんでした。"));
  });
}

function requestAsPromise<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB の読み書きに失敗しました。"));
  });
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => Promise<T>) {
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

export async function savePendingTeacherUpload(input: PendingTeacherUploadInput) {
  const now = new Date().toISOString();
  const record: PendingTeacherUploadRecord = {
    id: input.id,
    recordingId: input.recordingId,
    fileName: input.file.name,
    mimeType: input.file.type || "audio/webm",
    sizeBytes: input.file.size,
    durationSeconds: input.durationSeconds,
    recordedAt: input.recordedAt,
    updatedAt: now,
    errorMessage: input.errorMessage,
    status: input.status ?? "failed",
    blob: input.file,
  };

  return withStore("readwrite", async (store) => {
    await requestAsPromise(store.put(record));
    return record;
  });
}

export async function listPendingTeacherUploads() {
  return withStore("readonly", async (store) => {
    const records = await requestAsPromise(store.getAll());
    return ((records as PendingTeacherUploadRecord[] | undefined) ?? []).sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt)
    );
  });
}

export async function loadPendingTeacherUpload(id: string) {
  return withStore("readonly", async (store) => {
    const record = await requestAsPromise(store.get(id));
    return (record as PendingTeacherUploadRecord | undefined) ?? null;
  });
}

export async function removePendingTeacherUpload(id: string) {
  return withStore("readwrite", async (store) => {
    await requestAsPromise(store.delete(id));
  });
}
