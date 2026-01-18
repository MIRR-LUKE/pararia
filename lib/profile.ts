import { prisma } from "./db";
import { StructuredDelta } from "./ai/llm";

type Snapshot = {
  personal?: Record<
    string,
    {
      value: string;
      detail?: string;
      updatedAt?: string;
      sourceLogId?: string;
      confidence?: number;
      category?: string;
    }
  >;
  basics?: Record<
    string,
    {
      value: string;
      detail?: string;
      updatedAt?: string;
      sourceLogId?: string;
      confidence?: number;
      category?: string;
    }
  >;
};

function mergeSnapshot(current: Snapshot, delta: StructuredDelta, conversationId: string): Snapshot {
  const now = new Date().toISOString();
  const next: Snapshot = {
    personal: { ...(current.personal ?? {}) },
    basics: { ...(current.basics ?? {}) },
  };

  Object.entries(delta.personal ?? {}).forEach(([field, value]) => {
    next.personal![field] = {
      ...(next.personal?.[field] ?? {}),
      ...value,
      updatedAt: value.updatedAt ?? now,
      sourceLogId: value.sourceLogId ?? conversationId,
    };
  });

  Object.entries(delta.basics ?? {}).forEach(([field, value]) => {
    next.basics![field] = {
      ...(next.basics?.[field] ?? {}),
      ...value,
      updatedAt: value.updatedAt ?? now,
      sourceLogId: value.sourceLogId ?? conversationId,
    };
  });

  return next;
}

export async function applyProfileDelta(
  studentId: string,
  delta: StructuredDelta,
  conversationId: string
) {
  try {
    console.log("[applyProfileDelta] Starting...", { studentId, conversationId });
    
    // 最も新しいプロフィールを取得（存在しなければ新規作成）
    const latest = await prisma.studentProfile.findFirst({
      where: { studentId },
      orderBy: { createdAt: "desc" },
    });

    const currentSnapshot: Snapshot = (latest?.profileData as Snapshot) ?? {
      personal: {},
      basics: {},
    };

    const merged = mergeSnapshot(currentSnapshot, delta, conversationId);
    console.log("[applyProfileDelta] Merged snapshot:", {
      personalFields: Object.keys(merged.personal ?? {}).length,
      basicsFields: Object.keys(merged.basics ?? {}).length,
    });

    if (latest) {
      await prisma.studentProfile.update({
        where: { id: latest.id },
        data: {
          profileData: merged,
          updatedAt: new Date(),
        },
      });
      console.log("[applyProfileDelta] Profile updated:", latest.id);
    } else {
      const created = await prisma.studentProfile.create({
        data: {
          studentId,
          profileData: merged,
          basicData: merged.basics,
          summary: "会話ログから自動生成されたカルテ",
        },
      });
      console.log("[applyProfileDelta] Profile created:", created.id);
    }

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
