export type OperationalLogInput = {
  sessionType?: string | null;
  createdAt?: string | Date | null;
  summaryMarkdown?: string | null;
  timeline?: Array<{
    title?: string;
    what_happened?: string;
    coach_point?: string;
    student_state?: string;
    evidence_quotes?: string[];
  }> | null;
  nextActions?: Array<{
    owner?: string;
    action?: string;
    due?: string | null;
    metric?: string;
    why?: string;
  }> | null;
  parentPack?: {
    what_we_did?: string[];
    what_improved?: string[];
    what_to_practice?: string[];
    risks_or_notes?: string[];
    next_time_plan?: string[];
    evidence_quotes?: string[];
  } | null;
  studentState?: {
    label?: string;
    oneLiner?: string;
    rationale?: string[];
    confidence?: number;
  } | null;
  profileSections?: Array<{
    category?: string;
    status?: string;
    highlights?: Array<{ label?: string; value?: string }>;
    nextQuestion?: string;
  }> | null;
  quickQuestions?: Array<{ question?: string; reason?: string; category?: string }> | null;
  lessonReport?: {
    todayGoal?: string;
    covered?: string[];
    blockers?: string[];
    homework?: string[];
    nextLessonFocus?: string[];
    parentShare?: string;
    parentShareDraft?: string;
  } | null;
};

export type OperationalLog = {
  theme: string;
  facts: string[];
  changes: string[];
  assessment: string[];
  nextChecks: string[];
  parentShare: string[];
};

export type ReportBundleLog = {
  id: string;
  sessionId?: string | null;
  date: string;
  mode: "INTERVIEW" | "LESSON_REPORT";
  subType?: string | null;
  operationalLog: OperationalLog;
};

export type BundleQualityEval = {
  periodLabel: string;
  logCount: number;
  mainThemes: string[];
  strongElements: string[];
  weakElements: string[];
  parentPoints: string[];
  warnings: string[];
  suggestedLogIds: string[];
};

const SUMMARY_DUMP_PATTERNS = [
  /session summary/i,
  /next focus/i,
  /review this session/i,
  /validate progress/i,
  /focused practice/i,
  /maintains momentum/i,
  /priority\s*\d+/i,
  /confidence\s*\d+/i,
];

const SECTION_ALIASES: Record<keyof OperationalLog, string[]> = {
  theme: ["今回の会話テーマ", "会話テーマ", "今回のテーマ", "本日の指導サマリー", "本日の指導サマリー（室長向け要約）", "1. サマリー"],
  facts: ["事実として分かったこと", "会話で確認できた事実", "面談で確認した事実", "超解像度高い具体性を持ったサマリー", "1. サマリー"],
  changes: ["変化として見えたこと", "今回の変化", "今週の変化", "ポジティブな話題", "課題と指導成果", "課題と指導成果（Before → After）"],
  assessment: ["講師としての見立て", "指導の核", "講師の見立て", "改善・対策が必要な話題"],
  nextChecks: ["次に確認すべきこと", "次回までの方針", "次回方針", "学習方針と次回アクション", "学習方針と次回アクション（自学習の設計）"],
  parentShare: ["親共有に向く要素", "保護者共有に向く要素", "親共有ポイント", "室長・他講師への共有・連携事項", "保護者への共有ポイント"],
};

function stripMarkdown(text: string) {
  return text
    .replace(/^#+\s*/gm, "")
    .replace(/^\s*[-*]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\r/g, "")
    .trim();
}

function normalizeWhitespace(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function asArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value == null) return [];
  return [value as T];
}

function asObject<T>(value: unknown): Partial<T> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Partial<T>;
}

function normalizeKey(text: string) {
  return normalizeWhitespace(stripMarkdown(text)).replace(/[：:]/g, "");
}

function hasJapanese(text: string) {
  return /[ぁ-んァ-ヶ一-龠]/.test(text);
}

function alphaRatio(text: string) {
  if (!text) return 0;
  const alpha = (text.match(/[A-Za-z]/g) ?? []).length;
  return alpha / Math.max(1, text.length);
}

function englishWordCount(text: string) {
  return (text.match(/\b[A-Za-z][A-Za-z'/-]{2,}\b/g) ?? []).length;
}

function isJapanesePrimaryText(text: string) {
  const japaneseChars = (text.match(/[ぁ-んァ-ヶ一-龠]/g) ?? []).length;
  const latinChars = (text.match(/[A-Za-z]/g) ?? []).length;
  if (japaneseChars === 0) {
    return /^[A-Z0-9][A-Z0-9 .&/+_-]{1,12}$/.test(text);
  }
  if (englishWordCount(text) >= 4) return false;
  if (latinChars >= Math.max(18, japaneseChars)) return false;
  return true;
}

function isLowSignalPlaceholder(text: string) {
  if (!text) return true;
  if (SUMMARY_DUMP_PATTERNS.some((pattern) => pattern.test(text))) return true;
  const normalized = normalizeWhitespace(text).toLowerCase();
  return (
    normalized === "-" ||
    normalized === "なし" ||
    normalized === "未設定" ||
    normalized === "n/a" ||
    normalized === "todo"
  );
}

function sanitizeLine(text?: string | null) {
  if (!text) return null;
  const value = normalizeWhitespace(stripMarkdown(String(text)));
  if (!value) return null;
  if (isLowSignalPlaceholder(value)) return null;
  if (!isJapanesePrimaryText(value)) return null;
  if (!hasJapanese(value) && alphaRatio(value) >= 0.28) return null;
  return value;
}

function ensureSentence(text: string) {
  const value = normalizeWhitespace(text);
  if (!value) return value;
  if (/[。．！？]$/.test(value)) return value;
  return `${value}。`;
}

function dedupeLines(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const cleaned = sanitizeLine(value);
    if (!cleaned) continue;
    const key = cleaned.replace(/[。．！？\s]/g, "");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(cleaned);
  }
  return result;
}

function takeLines(values: Array<string | null | undefined>, limit: number, fallback: string[]) {
  const lines = dedupeLines(values).slice(0, limit);
  return lines.length > 0 ? lines : fallback;
}

function parseSummarySections(markdown?: string | null) {
  if (!markdown) return {} as Partial<Record<keyof OperationalLog, string[]>>;

  const lines = markdown.replace(/\r/g, "").split("\n");
  const buckets: Partial<Record<keyof OperationalLog, string[]>> = {};
  let currentKey: keyof OperationalLog | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith("## ") || line.startsWith("■ ")) {
      const heading = normalizeKey(line.slice(2).trim());
      currentKey =
        (Object.entries(SECTION_ALIASES).find(([, aliases]) =>
          aliases.some((alias) => normalizeKey(alias) === heading)
        )?.[0] as keyof OperationalLog | undefined) ?? null;
      continue;
    }

    if (!currentKey) continue;
    const target = buckets[currentKey] ?? [];
    target.push(line);
    buckets[currentKey] = target;
  }

  return buckets;
}

function deriveTheme(input: OperationalLogInput, parsed: Partial<Record<keyof OperationalLog, string[]>>) {
  const existing = dedupeLines(parsed.theme ?? []);
  if (existing.length > 0) return ensureSentence(existing.join(" "));

  const timeline = asArray<NonNullable<OperationalLogInput["timeline"]>[number]>(input.timeline);
  const profileSections = asArray<NonNullable<OperationalLogInput["profileSections"]>[number]>(input.profileSections);
  const lessonReport = asObject<NonNullable<OperationalLogInput["lessonReport"]>>(input.lessonReport);
  const parentPack = asObject<NonNullable<OperationalLogInput["parentPack"]>>(input.parentPack);
  const timelineTitles = dedupeLines(timeline.map((item) => item?.title));
  const factSeed = dedupeLines([
    ...asArray<string | null | undefined>(parentPack?.what_we_did),
    ...asArray<string | null | undefined>(lessonReport?.covered),
    ...profileSections.flatMap((section) =>
      asArray<{ label?: string; value?: string } | null | undefined>(section?.highlights).map((highlight) => highlight?.value)
    ),
  ]);

  if (input.sessionType === "LESSON_REPORT") {
    const todayGoal = sanitizeLine(lessonReport?.todayGoal);
    const lead = timelineTitles[0] ?? factSeed[0] ?? "授業前後のやり取り";
    return ensureSentence(
      todayGoal
        ? `${lead}を中心に、${todayGoal}に向けた授業の確認と次回への引き継ぎを整理した`
        : `${lead}を中心に、授業前後の状況と次回への引き継ぎを整理した`
    );
  }

  const lead = timelineTitles[0] ?? factSeed[0];
  if (lead) {
    return ensureSentence(`${lead}を中心に、現状と次の打ち手を確認した`);
  }

  return "今回の会話では、学習状況と今後の進め方を中心に確認した。";
}

function deriveFacts(input: OperationalLogInput, parsed: Partial<Record<keyof OperationalLog, string[]>>) {
  const timeline = asArray<NonNullable<OperationalLogInput["timeline"]>[number]>(input.timeline);
  const profileSections = asArray<NonNullable<OperationalLogInput["profileSections"]>[number]>(input.profileSections);
  const lessonReport = asObject<NonNullable<OperationalLogInput["lessonReport"]>>(input.lessonReport);
  const parentPack = asObject<NonNullable<OperationalLogInput["parentPack"]>>(input.parentPack);
  return takeLines(
    [
      ...(parsed.facts ?? []),
      ...(parsed.theme ?? []),
      ...asArray<string | null | undefined>(parentPack?.what_we_did),
      ...timeline.map((item) => item?.what_happened),
      ...asArray<string | null | undefined>(lessonReport?.covered),
      ...profileSections.flatMap((section) =>
        asArray<{ label?: string; value?: string } | null | undefined>(section?.highlights).map((highlight) => highlight?.value)
      ),
    ],
    4,
    ["今回の会話では、現状の学習状況と次に見るべき点を確認した。"]
  ).map(ensureSentence);
}

function deriveChanges(input: OperationalLogInput, parsed: Partial<Record<keyof OperationalLog, string[]>>) {
  const timeline = asArray<NonNullable<OperationalLogInput["timeline"]>[number]>(input.timeline);
  const studentState = asObject<NonNullable<OperationalLogInput["studentState"]>>(input.studentState);
  const lessonReport = asObject<NonNullable<OperationalLogInput["lessonReport"]>>(input.lessonReport);
  const parentPack = asObject<NonNullable<OperationalLogInput["parentPack"]>>(input.parentPack);
  return takeLines(
    [
      ...(parsed.changes ?? []),
      ...asArray<string | null | undefined>(parentPack?.what_improved),
      ...timeline.map((item) => item?.student_state),
      ...asArray<string | null | undefined>(studentState?.rationale),
      ...asArray<string | null | undefined>(lessonReport?.blockers).map((item) => `授業の中では ${item}`),
    ],
    4,
    ["前回からの変化はまだ十分に整理しきれていないため、次回の会話で継続確認する。"]
  ).map(ensureSentence);
}

function deriveAssessment(input: OperationalLogInput, parsed: Partial<Record<keyof OperationalLog, string[]>>) {
  const timeline = asArray<NonNullable<OperationalLogInput["timeline"]>[number]>(input.timeline);
  const nextActions = asArray<NonNullable<OperationalLogInput["nextActions"]>[number]>(input.nextActions);
  const studentState = asObject<NonNullable<OperationalLogInput["studentState"]>>(input.studentState);
  const lessonReport = asObject<NonNullable<OperationalLogInput["lessonReport"]>>(input.lessonReport);
  const parentPack = asObject<NonNullable<OperationalLogInput["parentPack"]>>(input.parentPack);
  const lessonAssessment = asArray<string | null | undefined>(lessonReport?.nextLessonFocus).map(
    (item) => `次回は ${item} を重点的に確認する必要がある`
  );
  return takeLines(
    [
      ...(parsed.assessment ?? []),
      ...asArray<string | null | undefined>(parentPack?.risks_or_notes),
      ...timeline.map((item) => item?.coach_point),
      ...nextActions.map((item) => item?.why),
      ...(studentState?.oneLiner ? [`現在の状態は「${studentState.oneLiner}」と整理できる`] : []),
      ...(lessonAssessment ?? []),
    ],
    4,
    ["現時点では、事実を踏まえて次回の確認ポイントを絞り込む段階にある。"]
  ).map(ensureSentence);
}

function deriveNextChecks(input: OperationalLogInput, parsed: Partial<Record<keyof OperationalLog, string[]>>) {
  const nextActions = asArray<NonNullable<OperationalLogInput["nextActions"]>[number]>(input.nextActions);
  const lessonReport = asObject<NonNullable<OperationalLogInput["lessonReport"]>>(input.lessonReport);
  const quickQuestions = asArray<NonNullable<OperationalLogInput["quickQuestions"]>[number]>(input.quickQuestions);
  const parentPack = asObject<NonNullable<OperationalLogInput["parentPack"]>>(input.parentPack);
  return takeLines(
    [
      ...(parsed.nextChecks ?? []),
      ...(parsed.assessment ?? []),
      ...nextActions.map((item) => {
        const action = sanitizeLine(item?.action);
        const metric = sanitizeLine(item?.metric);
        if (!action) return null;
        return metric ? `${action}。確認指標は ${metric}` : action;
      }),
      ...asArray<string | null | undefined>(lessonReport?.homework).map((item) => `宿題として ${item} を確認する`),
      ...asArray<string | null | undefined>(lessonReport?.nextLessonFocus).map((item) => `次回授業では ${item} を見る`),
      ...quickQuestions.map((item) => item?.question),
      ...asArray<string | null | undefined>(parentPack?.next_time_plan),
    ],
    5,
    ["次回は、今回決めた方針が実行できたかどうかを具体的に確認する。"]
  ).map(ensureSentence);
}

function deriveParentShare(input: OperationalLogInput, parsed: Partial<Record<keyof OperationalLog, string[]>>) {
  const lessonReport = asObject<NonNullable<OperationalLogInput["lessonReport"]>>(input.lessonReport);
  const parentPack = asObject<NonNullable<OperationalLogInput["parentPack"]>>(input.parentPack);
  return takeLines(
    [
      ...(parsed.parentShare ?? []),
      ...asArray<string | null | undefined>(parentPack?.what_we_did),
      ...asArray<string | null | undefined>(parentPack?.what_improved),
      ...asArray<string | null | undefined>(parentPack?.what_to_practice),
      ...asArray<string | null | undefined>(parentPack?.risks_or_notes),
      ...((lessonReport?.parentShare || lessonReport?.parentShareDraft)
        ? [lessonReport.parentShare ?? lessonReport.parentShareDraft]
        : []),
    ],
    4,
    ["保護者共有に向く具体ポイントは、今回の会話内容から引き続き整理していく。"]
  ).map(ensureSentence);
}

function formatDate(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("ja-JP");
}

function formatPeriodLabel(dates: string[]) {
  const sorted = dates
    .map((value) => new Date(value))
    .filter((value) => !Number.isNaN(value.getTime()))
    .sort((a, b) => a.getTime() - b.getTime());
  if (sorted.length === 0) return "期間未設定";
  const start = sorted[0];
  const end = sorted[sorted.length - 1];
  const startLabel = start.toLocaleDateString("ja-JP");
  const endLabel = end.toLocaleDateString("ja-JP");
  return startLabel === endLabel ? startLabel : `${startLabel}〜${endLabel}`;
}

function inferCategoryCoverage(logs: ReportBundleLog[]) {
  const joined = logs
    .flatMap((log) => [
      ...log.operationalLog.facts,
      ...log.operationalLog.changes,
      ...log.operationalLog.assessment,
      ...log.operationalLog.nextChecks,
    ])
    .join(" ");

  return {
    learning: /学習|数学|英語|国語|理科|社会|教材|模試|過去問|宿題|復習|授業/.test(joined),
    school: /学校|定期試験|内申|提出|先生|校内/.test(joined),
    life: /生活|睡眠|部活|体調|家庭|習慣/.test(joined),
    career: /進路|志望校|受験|大学|併願|検定/.test(joined),
  };
}

export function buildOperationalLog(input: OperationalLogInput): OperationalLog {
  const parsed = parseSummarySections(input.summaryMarkdown);
  return {
    theme: deriveTheme(input, parsed),
    facts: deriveFacts(input, parsed),
    changes: deriveChanges(input, parsed),
    assessment: deriveAssessment(input, parsed),
    nextChecks: deriveNextChecks(input, parsed),
    parentShare: deriveParentShare(input, parsed),
  };
}

export type OperationalLogRenderMeta = {
  sessionType?: string | null;
  studentName?: string | null;
  teacherName?: string | null;
  sessionDate?: string | Date | null;
  subject?: string | null;
  duration?: string | null;
  purpose?: string | null;
};

function formatRenderDate(value?: string | Date | null) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

export function renderOperationalSummaryMarkdown(log: OperationalLog, meta?: OperationalLogRenderMeta) {
  const isLessonReport = meta?.sessionType === "LESSON_REPORT";
  const lines: string[] = [];

  lines.push("■ 基本情報");
  lines.push(`• 対象生徒: ${meta?.studentName ?? "未設定"} 様`);
  if (isLessonReport) {
    lines.push(`• 指導日: ${formatRenderDate(meta?.sessionDate) || "未記録"}`);
    if (meta?.subject) lines.push(`• 教科・単元: ${meta.subject}`);
    lines.push(`• 担当チューター: ${meta?.teacherName ?? "未設定"}`);
  } else {
    lines.push(`• 面談日: ${formatRenderDate(meta?.sessionDate) || "未記録"}`);
    if (meta?.duration) lines.push(`• 面談時間: ${meta.duration}`);
    lines.push(`• 担当チューター: ${meta?.teacherName ?? "未設定"}`);
    if (meta?.purpose) lines.push(`• 面談目的: ${meta.purpose}`);
  }
  lines.push("");

  if (isLessonReport) {
    lines.push("■ 1. 本日の指導サマリー（室長向け要約）");
    lines.push(log.theme);
    if (log.facts.length > 0) {
      lines.push(log.facts.join(" "));
    }
    lines.push("");

    lines.push("■ 2. 課題と指導成果（Before → After）");
    for (const item of log.changes) {
      lines.push(`• ${item}`);
    }
    if (log.assessment.length > 0) {
      for (const item of log.assessment) {
        lines.push(`• ${item}`);
      }
    }
    lines.push("");

    lines.push("■ 3. 学習方針と次回アクション（自学習の設計）");
    if (log.nextChecks.length > 0) {
      lines.push(log.nextChecks[0]);
      if (log.nextChecks.length > 1) {
        lines.push("• 次回までの宿題:");
        for (const item of log.nextChecks.slice(1)) {
          lines.push(`  • ${item}`);
        }
      }
    }
    lines.push("");

    lines.push("■ 4. 室長・他講師への共有・連携事項");
    for (const item of log.parentShare) {
      lines.push(`• ${item}`);
    }
  } else {
    lines.push("■ 1. サマリー");
    lines.push(log.theme);
    if (log.facts.length > 0) {
      lines.push(log.facts.join(" "));
    }
    if (log.assessment.length > 0) {
      lines.push(log.assessment.join(" "));
    }
    lines.push("");

    lines.push("■ 2. ポジティブな話題");
    for (const item of log.changes) {
      lines.push(`• ${item}`);
    }
    lines.push("");

    lines.push("■ 3. 改善・対策が必要な話題");
    for (const item of log.nextChecks) {
      lines.push(`• ${item}`);
    }
    if (log.parentShare.length > 0) {
      lines.push("");
      lines.push("■ 4. 保護者への共有ポイント");
      for (const item of log.parentShare) {
        lines.push(`• ${item}`);
      }
    }
  }

  return lines.join("\n").trim();
}

function distinct<T>(values: T[]) {
  return Array.from(new Set(values));
}

export function buildBundleQualityEval(selectedLogs: ReportBundleLog[], allLogs: ReportBundleLog[] = []): BundleQualityEval {
  const dates = selectedLogs.map((log) => log.date);
  const mainThemes = distinct(selectedLogs.map((log) => log.operationalLog.theme)).slice(0, 3);
  const parentPoints = distinct(selectedLogs.flatMap((log) => log.operationalLog.parentShare)).slice(0, 4);
  const assessmentCount = selectedLogs.reduce((acc, log) => acc + log.operationalLog.assessment.length, 0);
  const nextCheckCount = selectedLogs.reduce((acc, log) => acc + log.operationalLog.nextChecks.length, 0);
  const includesInterview = selectedLogs.some((log) => log.mode === "INTERVIEW");
  const includesLesson = selectedLogs.some((log) => log.mode === "LESSON_REPORT");
  const coverage = inferCategoryCoverage(selectedLogs);
  const uniqueThemes = new Set(selectedLogs.map((log) => log.operationalLog.theme));
  const duplicateHeavy = selectedLogs.length >= 3 && uniqueThemes.size <= Math.ceil(selectedLogs.length / 2);

  const strongElements: string[] = [];
  if (assessmentCount > 0) strongElements.push("講師としての見立てが入っており、方針の理由まで説明しやすい");
  if (nextCheckCount >= selectedLogs.length) strongElements.push("次回までの確認事項が具体的で、次の行動に落とし込みやすい");
  if (includesInterview && includesLesson) strongElements.push("面談と指導報告が混ざっており、会話と授業の両面から経過を説明できる");

  const weakElements: string[] = [];
  if (parentPoints.length < 2) weakElements.push("家庭向けに伝えやすいポイントがまだ薄い");
  if (assessmentCount === 0) weakElements.push("講師としての見立てが弱く、単なる出来事の列挙に寄りやすい");
  if (!coverage.life) weakElements.push("生活面の情報が少なく、学習の背景説明が弱い");
  if (!coverage.career) weakElements.push("進路や受験全体の視点が少なく、中長期の見通しが弱い");

  const warnings: string[] = [];
  if (selectedLogs.length === 0) warnings.push("ログが選択されていません");
  if (selectedLogs.length === 1) warnings.push("1件だけだと変化より単発報告になりやすいため、必要なら補助ログを追加してください");
  if (duplicateHeavy) warnings.push("似た内容のログが多く、レポートが重複しやすい可能性があります");
  if (!includesInterview) warnings.push("面談ログが入っていないため、長期方針や本人特性の説明が薄くなる可能性があります");
  if (parentPoints.length === 0) warnings.push("家庭向けの声かけや見守りポイントが十分に抽出できていません");

  const missingDimensions = weakElements.length > 0;
  const suggestedLogIds = allLogs
    .filter((log) => !selectedLogs.some((selected) => selected.id === log.id))
    .filter((log) => {
      if (!includesInterview && log.mode === "INTERVIEW") return true;
      if (missingDimensions && log.operationalLog.parentShare.length > 0) return true;
      if (!coverage.career && /進路|受験|志望校/.test(log.operationalLog.theme + log.operationalLog.assessment.join(" "))) return true;
      return false;
    })
    .map((log) => log.id)
    .slice(0, 3);

  return {
    periodLabel: formatPeriodLabel(dates),
    logCount: selectedLogs.length,
    mainThemes,
    strongElements: strongElements.slice(0, 4),
    weakElements: weakElements.slice(0, 4),
    parentPoints,
    warnings,
    suggestedLogIds,
  };
}

export function buildBundlePreview(evalResult: BundleQualityEval) {
  const lines: string[] = [];
  lines.push(`対象期間: ${evalResult.periodLabel}`);
  lines.push(`選択ログ数: ${evalResult.logCount}件`);
  if (evalResult.mainThemes.length > 0) {
    lines.push(`主テーマ: ${evalResult.mainThemes.join(" / ")}`);
  }
  if (evalResult.strongElements.length > 0) {
    lines.push(`強い要素: ${evalResult.strongElements.join(" / ")}`);
  }
  if (evalResult.weakElements.length > 0) {
    lines.push(`弱い要素: ${evalResult.weakElements.join(" / ")}`);
  }
  if (evalResult.parentPoints.length > 0) {
    lines.push(`家庭向けポイント: ${evalResult.parentPoints.join(" / ")}`);
  }
  return lines.join("\n");
}

export function buildReuseBlocks(log: OperationalLog) {
  return [
    ...log.facts.map((text) => ({ type: "fact" as const, text })),
    ...log.changes.map((text) => ({ type: "change" as const, text })),
    ...log.assessment.map((text) => ({ type: "assessment" as const, text })),
    ...log.nextChecks.map((text) => ({ type: "next" as const, text })),
    ...log.parentShare.map((text) => ({ type: "parent" as const, text })),
  ];
}

export function buildConversationThemeLabel(log: OperationalLogInput) {
  const operational = buildOperationalLog(log);
  return operational.theme;
}

export function summarizeOperationalLogForList(log: OperationalLogInput) {
  const operational = buildOperationalLog(log);
  return {
    operational,
    summaryMarkdown: renderOperationalSummaryMarkdown(operational),
  };
}

export function buildReportBundleLog(input: OperationalLogInput & {
  id: string;
  sessionId?: string | null;
  date: string;
  mode: "INTERVIEW" | "LESSON_REPORT";
  subType?: string | null;
}) {
  return {
    id: input.id,
    sessionId: input.sessionId ?? null,
    date: input.date,
    mode: input.mode,
    subType: input.subType ?? null,
    operationalLog: buildOperationalLog(input),
  } satisfies ReportBundleLog;
}

export function buildOperationalSnapshotLabel(input: OperationalLogInput) {
  const createdAt = input.createdAt ? formatDate(input.createdAt) : "";
  const theme = buildOperationalLog(input).theme;
  return createdAt ? `${createdAt} / ${theme}` : theme;
}
