"use client";

import { Button } from "@/components/ui/Button";
import { LogDetailView } from "../../logs/LogDetailView";
import { StudentQueueDock } from "./StudentQueueDock";
import { StudentSessionConsole, type SessionConsoleLessonPart, type SessionConsoleMode } from "./StudentSessionConsole";
import { ReportStudio } from "./ReportStudio";
import type { ReportItem, SessionItem, WorkbenchPanel } from "./roomTypes";
import styles from "./studentWorkbench.module.css";

type RecommendedAction = {
  label: string;
  note: string;
  onClick: () => void;
};

type Props = {
  panel: WorkbenchPanel;
  studentId: string;
  studentName: string;
  sessions: SessionItem[];
  reports: ReportItem[];
  selectedSessionIds: string[];
  onSelectedSessionIdsChange: (ids: string[]) => void;
  recordingMode: SessionConsoleMode;
  lessonPart: SessionConsoleLessonPart;
  proofLogId: string | null;
  recommendedAction: RecommendedAction;
  onOpenRecording: (mode: SessionConsoleMode, part?: SessionConsoleLessonPart) => void;
  onOpenProcessing: () => void;
  onOpenProof: (logId: string) => void;
  onOpenReport: (options?: { sendReady?: boolean }) => void;
  onOpenGeneratedReport: () => void;
  onClosePanel: () => void;
  onRefresh: () => void;
};

function stageLabel(status: string) {
  if (status === "COLLECTING") return "チェックアウト待ち";
  if (status === "PROCESSING") return "内容整理中";
  if (status === "READY") return "確認待ち";
  if (status === "DONE") return "完了";
  if (status === "ERROR") return "エラー";
  return status;
}

function buildProcessingSteps(session: SessionItem) {
  if (session.status === "COLLECTING") {
    return ["アップロード完了", "授業後のチェックアウト待ち"];
  }

  const base = [
    "アップロード完了",
    "文字起こし中",
    "内容整理中",
    "固有名詞を整理中",
    "会話ログ要約作成中",
    "プロフィール更新案作成中",
  ];

  if (session.type === "LESSON_REPORT") {
    base.push("指導報告書作成中");
  }

  base.push("確認待ち");
  return base;
}

export function StudentWorkbench({
  panel,
  studentId,
  studentName,
  sessions,
  reports,
  selectedSessionIds,
  onSelectedSessionIdsChange,
  recordingMode,
  lessonPart,
  proofLogId,
  recommendedAction,
  onOpenRecording,
  onOpenProcessing,
  onOpenProof,
  onOpenReport,
  onOpenGeneratedReport,
  onClosePanel,
  onRefresh,
}: Props) {
  const isReportPanel = panel === "report_selection" || panel === "report_generated" || panel === "send_ready";
  const activeProcessingSessions = sessions.filter((session) => session.status === "PROCESSING" || session.status === "COLLECTING");
  const latestDraftReport = reports.find((report) => report.status !== "SENT") ?? null;

  return (
    <aside aria-label="生徒ルームの作業面">
      {panel === "recording" ? (
        <StudentSessionConsole
          studentId={studentId}
          studentName={studentName}
          mode={recordingMode}
          lessonPart={lessonPart}
          onModeChange={(mode) => onOpenRecording(mode, lessonPart)}
          onLessonPartChange={(part) => onOpenRecording("LESSON_REPORT", part)}
          onRefresh={onRefresh}
          onOpenProof={onOpenProof}
        />
      ) : null}

      {panel === "processing" ? (
        <section className={styles.workbenchSection}>
          <div className={styles.workbenchHeader}>
            <div>
              <div className={styles.eyebrow}>処理の進行</div>
              <h3 className={styles.workbenchTitle}>この生徒の生成進行だけを見る</h3>
              <p className={styles.mutedText}>保護者レポートはここでは作りません。録音から会話ログ・プロフィール差分までの進みだけを確認します。</p>
            </div>
            <Button size="small" variant="ghost" onClick={onClosePanel}>
              閉じる
            </Button>
          </div>

          {activeProcessingSessions.length === 0 ? (
            <div className={styles.emptyWorkbench}>いま進行中の処理はありません。必要なら次の録音を始められます。</div>
          ) : (
            <div className={styles.reportBlocks}>
              {activeProcessingSessions.map((session) => (
                <article key={session.id} className={styles.reportBlock}>
                  <div className={styles.reportBlockHead}>
                    <div>
                      <strong>{session.type === "LESSON_REPORT" ? "指導報告" : "面談"}</strong>
                      <p className={styles.mutedText}>{new Date(session.sessionDate).toLocaleString("ja-JP")} / {stageLabel(session.status)}</p>
                    </div>
                    <Button
                      size="small"
                      variant="secondary"
                      onClick={() =>
                        session.status === "COLLECTING"
                          ? onOpenRecording("LESSON_REPORT", "CHECK_OUT")
                          : session.conversation?.id
                            ? onOpenProof(session.conversation.id)
                            : onClosePanel()
                      }
                    >
                      {session.status === "COLLECTING" ? "チェックアウトを始める" : "根拠を開く"}
                    </Button>
                  </div>
                  <div className={styles.issueList}>
                    {buildProcessingSteps(session).map((step) => (
                      <p key={`${session.id}-${step}`}>{step}</p>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {panel === "proof" && proofLogId ? (
        <section className={styles.workbenchSection}>
          <div className={styles.workbenchHeader}>
            <div>
              <div className={styles.eyebrow}>根拠の確認</div>
              <h3 className={styles.workbenchTitle}>根拠をその場で確認する</h3>
              <p className={styles.mutedText}>この生徒の文脈を失わずに、要点・固有名詞・文字起こしを見返せます。</p>
            </div>
            <Button size="small" variant="ghost" onClick={onClosePanel}>
              閉じる
            </Button>
          </div>
          <LogDetailView logId={proofLogId} showHeader={false} onBack={onClosePanel} />
        </section>
      ) : null}

      {isReportPanel ? (
        <ReportStudio
          panel={panel}
          studentId={studentId}
          studentName={studentName}
          sessions={sessions}
          reports={reports}
          selectedSessionIds={selectedSessionIds}
          onSelectedSessionIdsChange={onSelectedSessionIdsChange}
          onRefresh={onRefresh}
          onOpenProof={onOpenProof}
          onOpenGenerated={onOpenGeneratedReport}
          onSendReady={() => onOpenReport({ sendReady: true })}
        />
      ) : null}

      {panel === "idle" ? (
        <section className={styles.workbenchSection}>
          <div className={styles.workbenchHeader}>
            <div>
              <div className={styles.eyebrow}>すぐ始める</div>
              <h3 className={styles.workbenchTitle}>録音はここから始める</h3>
              <p className={styles.mutedText}>
                面談も授業もここから始めます。止めた後は、この右側の作業面がそのまま処理確認や根拠確認に切り替わります。
              </p>
            </div>
          </div>
          <div className={styles.actionStack}>
            <Button onClick={() => onOpenRecording("INTERVIEW")}>面談を録音する</Button>
            <Button variant="secondary" onClick={() => onOpenRecording("LESSON_REPORT", "CHECK_IN")}>
              授業を録音する
            </Button>
            {recommendedAction.label !== "面談を録音する" && recommendedAction.label !== "授業を録音する" ? (
              <Button variant="ghost" onClick={recommendedAction.onClick}>
                いまのおすすめ: {recommendedAction.label}
              </Button>
            ) : null}
            {selectedSessionIds.length > 0 ? (
              <Button variant="ghost" onClick={() => onOpenReport()}>
                選択したログで保護者レポートを作る
              </Button>
            ) : null}
            {latestDraftReport ? (
              <Button variant="ghost" onClick={() => onOpenReport({ sendReady: true })}>
                送付前確認を開く
              </Button>
            ) : null}
          </div>
        </section>
      ) : null}

      <StudentQueueDock
        sessions={sessions}
        reports={reports}
        onOpenProof={onOpenProof}
        onOpenReport={onOpenReport}
        onOpenRecording={onOpenRecording}
        onOpenProcessing={onOpenProcessing}
      />

      {panel === "error" ? (
        <section className={styles.workbenchSection}>
          <div className={styles.inlineError}>処理の途中でエラーが起きました。再読み込みか、別のパネルからやり直してください。</div>
          <Button variant="secondary" onClick={onClosePanel}>閉じる</Button>
        </section>
      ) : null}
    </aside>
  );
}
