import type { TeacherStudentCandidate } from "./types";

type StudentCandidateRow = {
  id: string;
  name: string;
  nameKana?: string | null;
  grade?: string | null;
  course?: string | null;
};

const segmenter =
  typeof Intl !== "undefined" && typeof Intl.Segmenter === "function"
    ? new Intl.Segmenter("ja", { granularity: "word" })
    : null;

function normalizePhoneticCompareText(text: string) {
  return String(text ?? "")
    .normalize("NFKC")
    .replace(/[ 　\t\r\n]/g, "")
    .replace(/[・･\\\-ー_]/g, "")
    .replace(/[()（）「」『』【】\[\]。、，．！？!?:：;；]/g, "")
    .replace(/[\u3041-\u3096]/g, (value) => String.fromCharCode(value.charCodeAt(0) + 0x60))
    .toLowerCase();
}

function levenshtein(left: string, right: string) {
  const a = Array.from(left);
  const b = Array.from(right);
  const matrix = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i += 1) matrix[i][0] = i;
  for (let j = 0; j <= b.length; j += 1) matrix[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j - 1] + cost);
    }
  }
  return matrix[a.length][b.length];
}

function computeSimilarity(left: string, right: string) {
  if (!left || !right) return 0;
  if (left === right) return 1;
  const distance = levenshtein(left, right);
  return 1 - distance / Math.max(left.length, right.length, 1);
}

function buildTranscriptTokens(text: string) {
  const tokens = new Set<string>();
  if (!text.trim()) return [];

  if (segmenter) {
    const segments = segmenter.segment(text);
    for (const segment of segments) {
      const normalized = normalizePhoneticCompareText(segment.segment);
      const phonetic = normalizePhoneticCompareText(segment.segment);
      if (phonetic && phonetic.length >= 2) {
        tokens.add(phonetic);
      }
      if (!normalized || normalized.length < 2) continue;
      if ("isWordLike" in segment && segment.isWordLike === false) continue;
      tokens.add(normalized);
    }
  } else {
    const matches = text.matchAll(
      /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Latin}\p{Number}][\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Latin}\p{Number}・ー\-]*/gu
    );
    for (const match of matches) {
      const normalized = normalizePhoneticCompareText(match[0] ?? "");
      const phonetic = normalizePhoneticCompareText(match[0] ?? "");
      if (phonetic && phonetic.length >= 2) {
        tokens.add(phonetic);
      }
      if (!normalized || normalized.length < 2) continue;
      tokens.add(normalized);
    }
  }

  return [...tokens];
}

function buildSubtitle(student: StudentCandidateRow) {
  return [student.grade, student.course].filter(Boolean).join(" / ") || null;
}

export function buildTeacherStudentCandidates(input: {
  transcriptText: string;
  students: StudentCandidateRow[];
  limit?: number;
}): TeacherStudentCandidate[] {
  const transcriptComparable = normalizePhoneticCompareText(input.transcriptText);
  if (!transcriptComparable) return [];

  const transcriptTokens = buildTranscriptTokens(input.transcriptText);
  const scored = input.students
    .map((student) => {
      const nameComparable = normalizePhoneticCompareText(student.name);
      const nameKanaComparable = normalizePhoneticCompareText(student.nameKana ?? "");
      const comparisons = [nameComparable, nameKanaComparable].filter(Boolean);
      if (comparisons.length === 0) return null;

      let score = 0;
      let reason = "会話に近い名前が見つかりました。";

      if (nameComparable && transcriptComparable.includes(nameComparable)) {
        score = 100;
        reason = "会話の中に生徒名がそのまま含まれていました。";
      } else if (nameKanaComparable && transcriptComparable.includes(nameKanaComparable)) {
        score = 96;
        reason = "会話の中にフリガナに近い呼び方が含まれていました。";
      } else {
        for (const token of transcriptTokens) {
          for (const comparable of comparisons) {
            const similarity = computeSimilarity(token, comparable);
            const minimum = comparable.length <= 3 ? 0.9 : comparable.length <= 5 ? 0.84 : 0.76;
            if (similarity < minimum) continue;
            const nextScore = Math.max(62, Math.min(94, Math.round(similarity * 100)));
            if (nextScore > score) {
              score = nextScore;
              reason = "会話の中の呼び方が生徒名に近いと判断しました。";
            }
          }
        }
      }

      if (score <= 0) return null;

      const candidate: TeacherStudentCandidate = {
        id: student.id,
        name: student.name,
        reason,
        score,
        subtitle: buildSubtitle(student),
      };
      return candidate;
    })
    .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null)
    .sort((left, right) => {
      const leftScore = left.score ?? 0;
      const rightScore = right.score ?? 0;
      if (leftScore !== rightScore) return rightScore - leftScore;
      return left.name.localeCompare(right.name, "ja");
    });

  const seen = new Set<string>();
  return scored.filter((candidate) => {
    if (seen.has(candidate.id)) return false;
    seen.add(candidate.id);
    return true;
  }).slice(0, input.limit ?? 5);
}
