import assert from "node:assert/strict";
import { buildTeacherStudentCandidates } from "../lib/teacher-app/student-candidates.js";

const candidates = buildTeacherStudentCandidates({
  transcriptText: "今日は山田花子さんの英語の面談内容を確認しました。次回の宿題も共有しています。",
  students: [
    {
      id: "student-1",
      name: "山田 花子",
      nameKana: "ヤマダ ハナコ",
      grade: "中3",
      course: "英語",
    },
    {
      id: "student-2",
      name: "佐藤 翔",
      nameKana: "サトウ ショウ",
      grade: "高2",
      course: "数学",
    },
  ],
});

assert.equal(candidates[0]?.id, "student-1");
assert.equal(candidates[0]?.name, "山田 花子");
assert.equal(candidates[0]?.subtitle, "中3 / 英語");
assert.ok((candidates[0]?.score ?? 0) >= 96);

const kanaCandidates = buildTeacherStudentCandidates({
  transcriptText: "さとうしょうくんのチェックイン内容を記録します。",
  students: [
    {
      id: "student-1",
      name: "山田 花子",
      nameKana: "ヤマダ ハナコ",
      grade: "中3",
      course: "英語",
    },
    {
      id: "student-2",
      name: "佐藤 翔",
      nameKana: "サトウ ショウ",
      grade: "高2",
      course: "数学",
    },
  ],
});

assert.equal(kanaCandidates[0]?.id, "student-2");
console.log("teacher app student candidate checks passed");
