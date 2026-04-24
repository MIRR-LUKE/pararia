export const STUDENT_STATE_LABELS = [
  "前進",
  "集中",
  "安定",
  "不安",
  "疲れ",
  "詰まり",
  "落ち込み",
  "高揚",
] as const;

export const PROFILE_CATEGORIES = ["学習", "生活", "学校", "進路"] as const;

export type StudentStateLabel = (typeof STUDENT_STATE_LABELS)[number];
export type ProfileCategory = (typeof PROFILE_CATEGORIES)[number];
export type ProfileSectionStatus = "改善" | "維持" | "落ちた" | "不明";

export type StudentStateCard = {
  label: StudentStateLabel;
  oneLiner: string;
  rationale: string[];
  confidence: number;
};

export type RecommendedTopic = {
  category: ProfileCategory;
  title: string;
  reason: string;
  question: string;
  priority: number;
};

export type QuickQuestion = {
  category: ProfileCategory;
  question: string;
  reason: string;
};

export type ProfileSection = {
  category: ProfileCategory;
  status: ProfileSectionStatus;
  highlights: Array<{
    label: string;
    value: string;
    isNew?: boolean;
    isUpdated?: boolean;
  }>;
  nextQuestion: string;
};

export type ObservationEvent = {
  sourceType: "INTERVIEW";
  category: ProfileCategory;
  statusDraft: ProfileSectionStatus;
  insights: string[];
  topics: string[];
  nextActions: string[];
  evidence: string[];
  characterSignal: string;
  weight: number;
};
