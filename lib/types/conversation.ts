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

export type TimelineCandidate = {
  title: string;
  what_happened: string;
  coach_point: string;
  student_state: string;
  evidence_quotes: string[];
};

export type TodoCandidate = {
  owner: "COACH" | "STUDENT" | "PARENT";
  action: string;
  due: string | null;
  metric: string;
  why: string;
  evidence_quotes: string[];
};

export type ChunkAnalysis = {
  index: number;
  hash: string;
  facts: string[];
  coaching_points: string[];
  decisions: string[];
  student_state_delta: string[];
  todo_candidates: TodoCandidate[];
  timeline_candidates: TimelineCandidate[];
  profile_delta_candidates: ProfileDelta;
  quotes: string[];
  safety_flags: string[];
};

export type ReducedAnalysis = {
  facts: string[];
  coaching_points: string[];
  decisions: string[];
  student_state_delta: string[];
  todo_candidates: TodoCandidate[];
  timeline_candidates: TimelineCandidate[];
  profile_delta_candidates: ProfileDelta;
  quotes: string[];
  safety_flags: string[];
};

export type ParentPack = {
  what_we_did: string[];
  what_improved: string[];
  what_to_practice: string[];
  risks_or_notes: string[];
  next_time_plan: string[];
  evidence_quotes: string[];
};

export type FinalizeResult = {
  summaryMarkdown: string;
  timeline: TimelineSection[];
  nextActions: NextAction[];
  profileDelta: ProfileDelta;
  parentPack: ParentPack;
};

export type ConversationQualityMeta = {
  modelAnalyze?: string;
  modelReduce?: string;
  modelFinalize?: string;
  modelReportFinal?: string;
  summaryCharCount?: number;
  timelineSectionCount?: number;
  todoCount?: number;
  quotesCountTotal?: number;
  sttSeconds?: number;
  preprocessSeconds?: number;
  jobSecondsAnalyze?: number;
  jobSecondsReduce?: number;
  jobSecondsFinalize?: number;
  jobSecondsFormat?: number;
  llmApiCallsAnalyze?: number;
  llmApiCallsReduce?: number;
  llmApiCallsFinalize?: number;
  finalizeRepaired?: boolean;
  singlePassMode?: boolean;
  singlePassRepaired?: boolean;
  modelSinglePass?: string;
  jobSecondsSinglePass?: number;
  llmApiCallsSinglePass?: number;
  temperature?: number;
  promptVersion?: string;
  generatedAt?: string;
  inputTokensEstimate?: number;
  outputTokensEstimate?: number;
  errors?: string[];
};
