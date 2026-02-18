import { prisma } from "./db";
import type { ProfileDelta, ProfileDeltaItem } from "./types/conversation";

type Snapshot = {
  personal?: Array<ProfileDeltaItem & { updatedAt?: string; sourceLogId?: string }>;
  basic?: Array<ProfileDeltaItem & { updatedAt?: string; sourceLogId?: string }>;
  lastUpdatedFromLogId?: string;
};

function mergeItems(
  current: Array<ProfileDeltaItem & { updatedAt?: string; sourceLogId?: string }> | undefined,
  incoming: ProfileDeltaItem[] | undefined,
  conversationId: string
) {
  const now = new Date().toISOString();
  const map = new Map<string, ProfileDeltaItem & { updatedAt?: string; sourceLogId?: string }>();
  (current ?? []).forEach((item) => {
    const key = `${item.field}::${item.value}`;
    map.set(key, item);
  });
  (incoming ?? []).forEach((item) => {
    if (!item.field || !item.value) return;
    const key = `${item.field}::${item.value}`;
    map.set(key, {
      ...item,
      updatedAt: now,
      sourceLogId: conversationId,
    });
  });
  return Array.from(map.values());
}

function mergeSnapshot(current: Snapshot, delta: ProfileDelta, conversationId: string): Snapshot {
  const next: Snapshot = {
    personal: mergeItems(current.personal, delta.personal, conversationId),
    basic: mergeItems(current.basic, delta.basic, conversationId),
    lastUpdatedFromLogId: conversationId,
  };
  return next;
}

export async function applyProfileDelta(
  studentId: string,
  delta: ProfileDelta,
  conversationId: string
) {
  try {
    console.log("[applyProfileDelta] Starting...", { studentId, conversationId });
    
    // トランザクション内で取得と更新を実行して競合状態を防ぐ
    const merged = await prisma.$transaction(async (tx) => {
      // 最も新しいプロフィールを取得（存在しなければ新規作成）
      const latest = await tx.studentProfile.findFirst({
        where: { studentId },
        orderBy: { createdAt: "desc" },
      });

      const currentSnapshot: Snapshot = (latest?.profileData as Snapshot) ?? {
        personal: [],
        basic: [],
        lastUpdatedFromLogId: undefined,
      };

      const mergedSnapshot = mergeSnapshot(currentSnapshot, delta, conversationId);
      console.log("[applyProfileDelta] Merged snapshot:", {
        personalFields: mergedSnapshot.personal?.length ?? 0,
        basicsFields: mergedSnapshot.basic?.length ?? 0,
      });

      if (latest) {
        await tx.studentProfile.update({
          where: { id: latest.id },
          data: {
            profileData: mergedSnapshot,
            updatedAt: new Date(),
          },
        });
        console.log("[applyProfileDelta] Profile updated:", latest.id);
      } else {
        await tx.studentProfile.create({
          data: {
            studentId,
            profileData: mergedSnapshot,
            basicData: mergedSnapshot.basic,
            summary: "会話ログから自動生成されたカルテ",
          },
        });
        console.log("[applyProfileDelta] Profile created");
      }

      return mergedSnapshot;
    });

    return merged;
  } catch (error: any) {
    console.error("[applyProfileDelta] Error:", {
      error: error?.message,
      stack: error?.stack,
      studentId,
      conversationId,
    });
    throw error;
  }
}
