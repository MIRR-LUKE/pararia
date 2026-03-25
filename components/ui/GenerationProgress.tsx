import styles from "./GenerationProgress.module.css";
import type { GenerationProgressState } from "@/lib/generation-progress";

export function GenerationProgress({ progress }: { progress: GenerationProgressState }) {
  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <strong className={styles.title}>{progress.title}</strong>
        <span className={styles.percentage}>{progress.value}%</span>
      </div>
      <div className={styles.barTrack}>
        <div
          className={styles.barFill}
          style={{ width: `${progress.value}%` }}
        />
      </div>
      <p className={styles.description}>{progress.description}</p>
      <div className={styles.timeline}>
        {progress.steps.map((step, index) => (
          <div
            key={step.id}
            className={`${styles.timelineStep} ${
              step.status === "complete"
                ? styles.stepComplete
                : step.status === "active"
                  ? styles.stepActive
                  : step.status === "error"
                    ? styles.stepError
                    : styles.stepPending
            }`}
          >
            <div className={styles.stepIndicator}>
              <div className={styles.stepDot}>
                {step.status === "complete" ? (
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                    <path d="M2 5L4.5 7.5L8 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : step.status === "active" ? (
                  <span className={styles.pulse} />
                ) : step.status === "error" ? (
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                    <path d="M3 3L7 7M7 3L3 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                ) : null}
              </div>
              {index < progress.steps.length - 1 && (
                <div className={`${styles.stepLine} ${step.status === "complete" ? styles.lineComplete : ""}`} />
              )}
            </div>
            <span className={styles.stepLabel}>{step.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
