"use client";

import { memo } from "react";
import { GenerationProgress } from "@/components/ui/GenerationProgress";
import type { GenerationProgressState } from "@/lib/generation-progress";

type Props = {
  showGenerationProgress: boolean;
  progress: GenerationProgressState | null;
};

function StudentSessionConsoleProgressSectionInner({ showGenerationProgress, progress }: Props) {
  if (!showGenerationProgress || !progress) return null;
  return <GenerationProgress progress={progress} />;
}

StudentSessionConsoleProgressSectionInner.displayName = "StudentSessionConsoleProgressSection";

export const StudentSessionConsoleProgressSection = memo(StudentSessionConsoleProgressSectionInner);
