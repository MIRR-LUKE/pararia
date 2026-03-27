import assert from "node:assert/strict";
import {
  ConversationSourceType,
  ConversationStatus,
  ProperNounKind,
  ProperNounSuggestionStatus,
  SessionPartStatus,
  SessionPartType,
  SessionStatus,
  SessionType,
  TranscriptReviewState,
} from "@prisma/client";
import { prisma } from "../lib/db";
import {
  ensureConversationReviewedTranscript,
  ensureSessionPartReviewedTranscript,
  listConversationProperNounSuggestions,
  updateProperNounSuggestionDecision,
} from "../lib/transcript/review";

async function main() {
  const now = Date.now();
  const organization = await prisma.organization.create({
    data: {
      name: `review-test-org-${now}`,
    },
  });

  try {
    const user = await prisma.user.create({
      data: {
        organizationId: organization.id,
        email: `review-test-${now}@example.com`,
        passwordHash: "test",
        name: "佐藤先生",
        role: "TEACHER",
      },
    });

    const student = await prisma.student.create({
      data: {
        organizationId: organization.id,
        name: "山田花子",
        nameKana: "ヤマダ ハナコ",
        grade: "高2",
      },
    });

    await prisma.properNounGlossaryEntry.create({
      data: {
        organizationId: organization.id,
        studentId: student.id,
        tutorUserId: user.id,
        kind: ProperNounKind.SCHOOL,
        canonicalValue: "青山学院",
        aliasesJson: ["青山学園"],
      },
    });

    const session = await prisma.session.create({
      data: {
        organizationId: organization.id,
        studentId: student.id,
        userId: user.id,
        type: SessionType.INTERVIEW,
        status: SessionStatus.PROCESSING,
      },
    });

    const part = await prisma.sessionPart.create({
      data: {
        sessionId: session.id,
        partType: SessionPartType.FULL,
        sourceType: ConversationSourceType.MANUAL,
        status: SessionPartStatus.READY,
        rawTextOriginal:
          "講師: 今日の英語長文は青山学園の過去問を使います。\n生徒: 青山学園の過去問で順番に迷いました。\n講師: まず条件整理をして、本文から根拠を拾いましょう。\n生徒: 図にすると順番が少し見えました。\n講師: 次回も同じ手順で再現できるか確認します。",
        rawTextCleaned:
          "講師: 今日の英語長文は青山学園の過去問を使います。\n生徒: 青山学園の過去問で順番に迷いました。\n講師: まず条件整理をして、本文から根拠を拾いましょう。\n生徒: 図にすると順番が少し見えました。\n講師: 次回も同じ手順で再現できるか確認します。",
      },
    });

    const partReview = await ensureSessionPartReviewedTranscript(part.id);
    assert.equal(partReview.reviewState, TranscriptReviewState.REQUIRED);
    assert.match(partReview.reviewedText, /青山学院/);
    assert.ok(partReview.pendingSuggestionCount >= 1);

    const conversation = await prisma.conversationLog.create({
      data: {
        organizationId: organization.id,
        studentId: student.id,
        userId: user.id,
        sessionId: session.id,
        sourceType: ConversationSourceType.MANUAL,
        status: ConversationStatus.PROCESSING,
        rawTextOriginal:
          "## 面談・通し録音\n講師: 今日の英語長文は青山学園の過去問を使います。\n生徒: 青山学園の過去問で順番に迷いました。\n講師: まず条件整理をして、本文から根拠を拾いましょう。\n生徒: 図にすると順番が少し見えました。\n講師: 次回も同じ手順で再現できるか確認します。",
        rawTextCleaned:
          "## 面談・通し録音\n講師: 今日の英語長文は青山学園の過去問を使います。\n生徒: 青山学園の過去問で順番に迷いました。\n講師: まず条件整理をして、本文から根拠を拾いましょう。\n生徒: 図にすると順番が少し見えました。\n講師: 次回も同じ手順で再現できるか確認します。",
      },
    });

    const conversationReview = await ensureConversationReviewedTranscript(conversation.id);
    assert.equal(conversationReview.reviewState, TranscriptReviewState.REQUIRED);
    assert.match(conversationReview.reviewedText, /青山学院/);

    const reviewList = await listConversationProperNounSuggestions(conversation.id);
    assert.ok(reviewList.suggestions.length >= 1);
    const firstSuggestion = reviewList.suggestions[0];
    assert.equal(firstSuggestion.status, ProperNounSuggestionStatus.PENDING);

    for (const suggestion of reviewList.suggestions) {
      await updateProperNounSuggestionDecision({
        suggestionId: suggestion.id,
        status: ProperNounSuggestionStatus.CONFIRMED,
        finalValue: "青山学院",
      });
    }

    const afterConfirm = await listConversationProperNounSuggestions(conversation.id);
    assert.ok(afterConfirm.suggestions.every((suggestion) => suggestion.status !== ProperNounSuggestionStatus.PENDING));
    assert.equal(afterConfirm.reviewState, TranscriptReviewState.RESOLVED);

    console.log("transcript review regression checks passed");
  } finally {
    await prisma.properNounSuggestion.deleteMany({
      where: { organizationId: organization.id },
    });
    await prisma.conversationLog.deleteMany({
      where: { organizationId: organization.id },
    });
    await prisma.sessionPart.deleteMany({
      where: { session: { organizationId: organization.id } },
    });
    await prisma.session.deleteMany({
      where: { organizationId: organization.id },
    });
    await prisma.properNounGlossaryEntry.deleteMany({
      where: { organizationId: organization.id },
    });
    await prisma.student.deleteMany({
      where: { organizationId: organization.id },
    });
    await prisma.user.deleteMany({
      where: { organizationId: organization.id },
    });
    await prisma.organization.delete({
      where: { id: organization.id },
    });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
