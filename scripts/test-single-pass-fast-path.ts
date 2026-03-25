#!/usr/bin/env tsx

import assert from "node:assert/strict";

process.env.LLM_API_KEY ??= "test-key";
process.env.OPENAI_API_KEY ??= process.env.LLM_API_KEY;

function installMockFetch() {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (!url.includes("/v1/chat/completions")) {
      throw new Error(`Unexpected fetch URL: ${url}`);
    }

    const body = JSON.parse(String(init?.body ?? "{}")) as {
      messages?: Array<{ role: string; content: string }>;
    };
    const userText = body.messages?.find((message) => message.role === "user")?.content ?? "";
    const isLesson = /LESSON_REPORT/.test(userText);

    const payload = isLesson
      ? {
          summaryMarkdown: [
            "■ 基本情報",
            "対象生徒: テスト生徒 様。",
            "指導日: 2026年3月25日。",
            "教科・単元: 数学 / 極限。",
            "担当チューター: テスト先生。",
            "■ 1. 本日の指導サマリー（室長向け要約）",
            "本日は極限の考え方を扱い、支配的な項を見る視点を整理した。見通し自体は立つが、説明の再現性には課題が残る。",
            "感覚的には理解できても、答案としてどこまで根拠を書くべきかはまだ不安定であり、次回も継続確認が必要である。",
            "■ 2. 課題と指導成果（Before → After）",
            "【極限】支配項を見る視点の整理。",
            "現状（Before）: 見通しは立つが、なぜその項が支配的かを説明する根拠が弱かった。",
            "成果（After）: 支配項を見る流れを言語化でき、答案としての説明の入口が見えた。",
            "※特記事項: 直感で答えの方向は読めるため、その強みを残しつつ論理説明へ接続する運用が有効である。",
            "【次回接続】挟み撃ちの原理への導線。",
            "現状（Before）: 振動する関数をどう論理で扱うかはまだ整理できていなかった。",
            "成果（After）: 次回は定数で挟む考え方へ進むと理解できた。",
            "■ 3. 学習方針と次回アクション（自学習の設計）",
            "次回までは、極限の基礎問題を使って支配項を口頭で説明する練習を優先する。",
            "新しい内容を広げるよりも、既習範囲で説明の型を固める方が短期的な定着につながる。",
            "次回までの宿題:",
            "- 極限の基礎問題を復習する。",
            "次回の確認（テスト）事項:",
            "- 支配項の説明ができるか。",
            "■ 4. 室長・他講師への共有・連携事項",
            "現時点で強い介入は不要だが、説明の再現性は継続確認が必要。",
            "他教科でも、理解できた感覚だけで終わらせず、理由を一言説明させる確認が有効である。",
          ].join("\n"),
          nextActions: [
            {
              owner: "STUDENT",
              action: "極限の基礎問題を復習する。",
              due: null,
              metric: "支配項を説明できる。",
              why: "次回の確認のため。",
            },
          ],
          lessonReport: {
            todayGoal: "極限の見方を整理する。",
            covered: ["支配的な項の比較"],
            blockers: ["説明の再現性"],
            homework: ["極限の基礎問題を復習する。"],
            nextLessonFocus: ["挟み撃ちの原理"],
            parentShareDraft: "見通しはあるが説明の定着が必要。",
          },
        }
      : {
          summaryMarkdown: [
            "■ 基本情報",
            "対象生徒: 山田 太郎 様",
            "面談日: 2026年3月25日",
            "面談時間: 未記録",
            "担当チューター: 佐藤",
            "面談目的: 学習状況の確認と次回方針の整理",
            "",
            "■ 1. サマリー",
            "模試数学では最初の一手が遅れやすく、英語は音読継続が効果的と整理した。今回の面談では、止まる場面を感覚ではなく事実として残し、次回の会話を具体的な振り返りから始める方針まで置いた。本人は不安を抱えつつも、実行手順が見えると前向きに動けることが確認できた。",
            "",
            "■ 2. ポジティブな話題",
            "- 英語は音読を続けた日に読み直しが減っており、本人もやり方の手応えを持てている。",
            "- 実行方法が明確になると、不安の中でも前向きに動ける土台がある。",
            "",
            "■ 3. 改善・対策が必要な話題",
            "- 数学は最初の一手が出ない場面を曖昧なままにしやすいため、次回までに一題分の思考メモを残し、止まった理由を振り返れる状態を作る必要がある。",
            "- 英語は音読の継続が効いている一方で、続け方が崩れると手応えが薄れやすいため、短時間でも継続記録を残す運用を続ける必要がある。",
          ].join("\n"),
          nextActions: [
            {
              owner: "STUDENT",
              action: "数学の思考メモを一題分残す。",
              due: null,
              metric: "実行内容が1件以上ある。",
              why: "次回面談を事実ベースで進めるため。",
            },
          ],
        };

    return new Response(
      JSON.stringify({
        choices: [
          {
            message: { content: JSON.stringify(payload) },
            finish_reason: "stop",
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }) as typeof fetch;
}

async function main() {
  installMockFetch();
  const { generateConversationArtifactsSinglePass } = await import("../lib/ai/conversationPipeline");

  const interview = await generateConversationArtifactsSinglePass({
    transcript:
      "模試の数学で最初の一手が出ずに止まりやすい。英語は音読を続けた日に読み直しが減る。次回までに数学の思考メモを一題分残す。",
    studentName: "山田 太郎",
    teacherName: "佐藤",
    minSummaryChars: 220,
    minTimelineSections: 2,
    sessionType: "INTERVIEW",
  });
  assert.ok(interview.result.summaryMarkdown.length >= 220);
  assert.ok(interview.result.summaryMarkdown.includes("■ 1. サマリー"));
  assert.ok(interview.result.timeline.length >= 2);
  assert.ok(interview.result.nextActions.length >= 1);
  assert.ok(interview.result.recommendedTopics.length >= 1);
  assert.ok(interview.result.profileSections.length >= 1);

  const lesson = await generateConversationArtifactsSinglePass({
    transcript:
      "チェックインでは極限の宿題状況を確認した。チェックアウトでは支配的な項を見る流れを整理し、次回は挟み撃ちの原理を扱うと共有した。",
    studentName: "田中 花子",
    teacherName: "浅見",
    sessionDate: "2026-03-25",
    minSummaryChars: 600,
    minTimelineSections: 2,
    sessionType: "LESSON_REPORT",
  });
  assert.ok(lesson.result.summaryMarkdown.includes("■ 1. 本日の指導サマリー"));
  assert.ok(lesson.result.nextActions.length >= 1);
  assert.ok(lesson.result.lessonReport);

  console.log("test-single-pass-fast-path: ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
