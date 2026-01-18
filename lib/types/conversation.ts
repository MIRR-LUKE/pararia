export type TimelineSection = {
  title: string;
  what_happened: string;
  coach_point: string;
  student_state: string;
  evidence_quotes: string[];
};

export type NextAction = {
  owner: "COACH" | "STUDENT" | "PARENT";
  action: string;
  due: string | null;
  metric: string;
  why: string;
};

export type ProfileDeltaItem = {
  field: string;
  value: string;
  confidence: number;
  evidence_quotes: string[];
};

export type ProfileDelta = {
  basic: ProfileDeltaItem[];
  personal: ProfileDeltaItem[];
};

export type ChunkSummaryMemo = {
  index: number;
  facts: string[];
  coach_points: string[];
  decisions: string[];
  quotes: string[];
};

export type ChunkExtractMemo = {
  index: number;
  timeline_candidates: Array<{
    title: string;
    what_happened: string;
    coach_point: string;
    student_state: string;
    evidence_quotes: string[];
  }>;
  todo_candidates: Array<{
    owner: "COACH" | "STUDENT" | "PARENT";
    action: string;
    due: string | null;
    metric: string;
    why: string;
    evidence_quotes: string[];
  }>;
  profile_delta_candidates: {
    basic: ProfileDeltaItem[];
    personal: ProfileDeltaItem[];
  };
};

export type MergeResult = {
  summaryMarkdown: string;
  timeline: TimelineSection[];
  nextActions: NextAction[];
  profileDelta: ProfileDelta;
};

export type ConversationQualityMeta = {
  modelSummaryFinal?: string;
  modelExtractFinal?: string;
  modelReportFinal?: string;
  summaryCharCount?: number;
  timelineSectionCount?: number;
  todoCount?: number;
  quotesCountTotal?: number;
  sttSeconds?: number;
  preprocessSeconds?: number;
  jobSecondsSummary?: number;
  jobSecondsExtract?: number;
  jobSecondsMerge?: number;
  jobSecondsFormat?: number;
  temperature?: number;
  promptVersion?: string;
  generatedAt?: string;
  inputTokensEstimate?: number;
  outputTokensEstimate?: number;
  errors?: string[];
};
