"use client";

import { Button } from "@/components/ui/Button";
import type { TeacherStudentCandidate } from "@/lib/teacher-app/types";
import styles from "../teacher.module.css";

type Props = {
  candidates: TeacherStudentCandidate[];
  onChoose: (studentId: string | null) => void;
  onChooseNone: () => void;
};

export function TeacherStudentConfirmScreen({ candidates, onChoose, onChooseNone }: Props) {
  return (
    <div className={styles.stack}>
      <div className={styles.statusBlock}>
        <div className={styles.statusLabel}>この生徒で合っていますか？</div>
      </div>
      <div className={styles.candidateList}>
        {candidates.map((candidate) => (
          <button
            key={candidate.id}
            type="button"
            className={styles.candidateButton}
            onClick={() => onChoose(candidate.id)}
          >
            <strong>{candidate.name}</strong>
            {candidate.subtitle ? <span>{candidate.subtitle}</span> : null}
          </button>
        ))}
      </div>
      <Button variant="secondary" className={styles.secondaryButton} onClick={onChooseNone}>
        該当なし
      </Button>
    </div>
  );
}
