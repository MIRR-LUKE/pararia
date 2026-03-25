type TimelineItem = {
  title: string;
  what_happened: string;
  coach_point: string;
  student_state: string;
  evidence_quotes: string[];
};

type NextActionItem = {
  owner: string;
  action: string;
  due: string | null;
  metric: string;
  why: string;
};

type StudentStateItem = {
  label: string;
  oneLiner: string;
  rationale: string[];
  confidence: number;
};

type ProfileSectionItem = {
  category: string;
  status: string;
  highlights: Array<{ label: string; value: string; isNew?: boolean; isUpdated?: boolean }>;
  nextQuestion: string;
};

type LessonReportView = {
  goal?: string;
  did?: string[];
  blocked?: string[];
  homework?: string[];
  nextLessonFocus?: string[];
  parentShare?: string;
  coachMemo?: string;
  todayGoal?: string;
  covered?: string[];
  blockers?: string[];
  parentShareDraft?: string;
};

function asArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value == null) return [];
  return [value as T];
}

function asObject<T>(value: unknown): Partial<T> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Partial<T>;
}

function asText(value: unknown, fallback = "") {
  if (typeof value !== "string") return fallback;
  const text = value.trim();
  return text || fallback;
}

function asTextList(value: unknown, limit: number) {
  const seen = new Set<string>();
  const items: string[] = [];
  for (const raw of asArray<unknown>(value)) {
    const text = asText(raw);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    items.push(text);
    if (items.length >= limit) break;
  }
  return items;
}

export function normalizeTimelineForView(value: unknown): TimelineItem[] {
  return asArray<Record<string, unknown> | null | undefined>(value)
    .map((item) => {
      const current = asObject<Record<string, unknown>>(item);
      const title = asText(current?.title);
      const what_happened = asText(current?.what_happened);
      const coach_point = asText(current?.coach_point);
      const student_state = asText(current?.student_state);
      if (!title && !what_happened && !coach_point && !student_state) return null;
      return {
        title: title || "今回の論点",
        what_happened,
        coach_point,
        student_state,
        evidence_quotes: asTextList(current?.evidence_quotes, 6),
      };
    })
    .filter((item): item is TimelineItem => Boolean(item))
    .slice(0, 8);
}

export function normalizeNextActionsForView(value: unknown): NextActionItem[] {
  return asArray<Record<string, unknown> | null | undefined>(value)
    .map((item) => {
      const current = asObject<Record<string, unknown>>(item);
      const action = asText(current?.action);
      const metric = asText(current?.metric);
      if (!action || !metric) return null;
      return {
        owner: asText(current?.owner, "STUDENT"),
        action,
        due: asText(current?.due) || null,
        metric,
        why: asText(current?.why),
      };
    })
    .filter((item): item is NextActionItem => Boolean(item))
    .slice(0, 8);
}

export function normalizeStudentStateForView(value: unknown): StudentStateItem | null {
  const current = asObject<Record<string, unknown>>(value);
  if (!current) return null;
  const oneLiner = asText(current.oneLiner);
  const label = asText(current.label);
  const rationale = asTextList(current.rationale, 6);
  if (!oneLiner && !label && rationale.length === 0) return null;
  return {
    label: label || "安定",
    oneLiner: oneLiner || "今回の変化はまだ整理中です。",
    rationale,
    confidence: Number.isFinite(Number(current.confidence)) ? Number(current.confidence) : 60,
  };
}

export function normalizeProfileSectionsForView(value: unknown): ProfileSectionItem[] {
  return asArray<Record<string, unknown> | null | undefined>(value)
    .map((item) => {
      const current = asObject<Record<string, unknown>>(item);
      const highlights = asArray<Record<string, unknown> | null | undefined>(current?.highlights)
        .map((highlight) => {
          const next = asObject<Record<string, unknown>>(highlight);
          const label = asText(next?.label);
          const text = asText(next?.value);
          if (!label || !text) return null;
          return {
            label,
            value: text,
            isNew: Boolean(next?.isNew),
            isUpdated: Boolean(next?.isUpdated),
          };
        })
        .filter(Boolean)
        .slice(0, 6) as ProfileSectionItem["highlights"];
      const nextQuestion = asText(current?.nextQuestion);
      if (highlights.length === 0 && !nextQuestion) return null;
      return {
        category: asText(current?.category, "学習"),
        status: asText(current?.status, "不明"),
        highlights,
        nextQuestion: nextQuestion || "次回もう少し具体的に確認します。",
      };
    })
    .filter(Boolean)
    .slice(0, 6) as ProfileSectionItem[];
}

export function normalizeLessonReportForView(value: unknown): LessonReportView | null {
  const current = asObject<Record<string, unknown>>(value);
  if (!current) return null;

  const goal = asText(current.goal ?? current.todayGoal);
  const did = asTextList(current.did ?? current.covered, 6);
  const blocked = asTextList(current.blocked ?? current.blockers, 6);
  const homework = asTextList(current.homework, 6);
  const nextLessonFocus = asTextList(current.nextLessonFocus, 6);
  const parentShare = asText(current.parentShare ?? current.parentShareDraft);
  const coachMemo = asText(current.coachMemo ?? current.parentShareDraft);

  if (!goal && did.length === 0 && blocked.length === 0 && homework.length === 0 && nextLessonFocus.length === 0 && !parentShare && !coachMemo) {
    return null;
  }

  return {
    goal: goal || undefined,
    did,
    blocked,
    homework,
    nextLessonFocus,
    parentShare: parentShare || undefined,
    coachMemo: coachMemo || undefined,
    todayGoal: goal || undefined,
    covered: did,
    blockers: blocked,
    parentShareDraft: coachMemo || parentShare || undefined,
  };
}
