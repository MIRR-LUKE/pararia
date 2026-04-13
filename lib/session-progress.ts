export type {
  SessionProgressConversationLike,
  SessionProgressConversationJobLike,
  SessionProgressErrorCopy,
  SessionProgressInput,
  SessionProgressMode,
  SessionProgressPartLike,
  SessionProgressPartType,
  SessionProgressPhaseCopy,
  SessionProgressProgressPayload,
  SessionProgressRule,
  SessionProgressStage,
  SessionProgressState,
  SessionProgressTranscriptionCopy,
  SessionProgressWaitingCopy,
} from "./session-progress/types";

import { resolveSessionProgressState } from "./session-progress/table";
import type { SessionProgressInput, SessionProgressState } from "./session-progress/types";

export function buildSessionProgressState(input: SessionProgressInput): SessionProgressState {
  return resolveSessionProgressState(input);
}
