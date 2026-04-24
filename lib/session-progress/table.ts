import {
  buildConversationDoneState,
  buildConversationErrorState,
  buildIdleState,
  buildInterviewState,
  buildProcessingErrorState,
  buildReceivedState,
  buildRejectedState,
  hasRejectedPart,
  isBusy,
  isReady,
} from "./states";
import type { SessionProgressInput, SessionProgressRule, SessionProgressState } from "./types";

const SESSION_PROGRESS_TRANSITION_TABLE: SessionProgressRule[] = [
  {
    id: "conversation-done",
    match: (input) => input.conversation?.status === "DONE",
    build: buildConversationDoneState,
  },
  {
    id: "conversation-error",
    match: (input) => input.conversation?.status === "ERROR",
    build: buildConversationErrorState,
  },
  {
    id: "rejected-part",
    match: (input) => hasRejectedPart(input.parts),
    build: buildRejectedState,
  },
  {
    id: "processing-error",
    match: (input) => input.parts.some((part) => part.status === "ERROR"),
    build: buildProcessingErrorState,
  },
  {
    id: "interview-state",
    match: (input) => input.parts.some((part) => isBusy(part) || isReady(part)),
    build: (input) => buildInterviewState(input) ?? buildReceivedState(input),
  },
  {
    id: "received",
    match: (input) => input.parts.length > 0,
    build: buildReceivedState,
  },
  {
    id: "idle",
    match: () => true,
    build: buildIdleState,
  },
];

export function resolveSessionProgressState(input: SessionProgressInput): SessionProgressState {
  const matchedRule = SESSION_PROGRESS_TRANSITION_TABLE.find((rule) => rule.match(input));
  return (matchedRule ?? SESSION_PROGRESS_TRANSITION_TABLE[SESSION_PROGRESS_TRANSITION_TABLE.length - 1]).build(input);
}
