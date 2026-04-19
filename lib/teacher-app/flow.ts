import type { PendingTeacherUploadItem, TeacherAppBootstrap, TeacherAppDeviceSession, TeacherFlowState } from "./types";

export function buildTeacherFlowState(input?: {
  pendingItems?: PendingTeacherUploadItem[];
}): TeacherFlowState {
  const pendingItems = input?.pendingItems ?? [];
  if (pendingItems.length > 0) {
    return {
      kind: "pending",
      items: pendingItems,
    };
  }
  return {
    kind: "standby",
    unsentCount: 0,
  };
}

export function buildTeacherAppBootstrap(session: TeacherAppDeviceSession): TeacherAppBootstrap {
  return {
    session,
    initialState: buildTeacherFlowState(),
  };
}
