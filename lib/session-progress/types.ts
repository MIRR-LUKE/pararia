import type { GenerationProgressState, GenerationStep } from "@/lib/generation-progress";

export type SessionProgressMode = "INTERVIEW";

export type SessionProgressStage =
  | "IDLE"
  | "RECEIVED"
  | "TRANSCRIBING"
  | "WAITING_COUNTERPART"
  | "GENERATING"
  | "READY"
  | "REJECTED"
  | "ERROR";

export type SessionProgressPartType = "FULL" | "CHECK_IN" | "CHECK_OUT" | (string & {});

export type SessionProgressPartLike = {
  id: string;
  partType: SessionProgressPartType;
  status: string;
  rawTextOriginal?: string | null;
  rawTextCleaned?: string | null;
  qualityMetaJson?: unknown;
};

export type SessionProgressConversationJobLike = {
  type?: string | null;
  status?: string | null;
  startedAt?: Date | string | null;
  finishedAt?: Date | string | null;
};

export type SessionProgressConversationLike = {
  id: string;
  status: string;
  summaryMarkdown?: string | null;
  createdAt?: Date | string | null;
  jobs?: SessionProgressConversationJobLike[];
};

export type SessionProgressInput = {
  sessionId: string;
  type: SessionProgressMode;
  parts: SessionProgressPartLike[];
  conversation?: SessionProgressConversationLike | null;
};

export type SessionProgressState = {
  stage: SessionProgressStage;
  statusLabel: string;
  canLeavePage: boolean;
  canOpenLog: boolean;
  openLogId: string | null;
  waitingForPart: "CHECK_IN" | "CHECK_OUT" | null;
  progress: GenerationProgressState;
};

export type SessionProgressRule = {
  id: string;
  match: (input: SessionProgressInput) => boolean;
  build: (input: SessionProgressInput) => SessionProgressState;
};

export type SessionProgressProgressPayload = {
  title: string;
  description: string;
  value: number;
  steps: GenerationStep[];
};

export type SessionProgressPhaseCopy = {
  statusLabel: string;
  title: string;
  description: string;
};

export type SessionProgressTranscriptionCopy = SessionProgressPhaseCopy & {
  unitLabel: string;
  start: number;
  end: number;
  acceptedTitle: string;
  acceptedDescription: string;
};

export type SessionProgressWaitingCopy = SessionProgressPhaseCopy & {
  waitingForPart: "CHECK_IN" | "CHECK_OUT";
  value: number;
};

export type SessionProgressErrorCopy = SessionProgressPhaseCopy & {
  stepIndex: number;
  value: number;
};
