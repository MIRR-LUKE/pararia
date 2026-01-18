"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AppHeader } from "@/components/layout/AppHeader";
import { Card } from "@/components/ui/Card";
import { Progress } from "@/components/ui/Progress";
import styles from "./students.module.css";
import {
  getConversationsByStudentId,
  getProfileCompleteness,
  students,
} from "@/lib/mockData";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { DEFAULT_TEACHER_FULL_NAME } from "@/lib/constants";

type SortKey = "latest" | "oldest" | "logCount";

export default function StudentsPage() {
  const router = useRouter();
  const [data, setData] = useState(students);
  const [keyword, setKeyword] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("latest");
  const [showNewForm, setShowNewForm] = useState(false);
  const [newStudent, setNewStudent] = useState({
    name: "",
    nameKana: "",
    grade: "",
    enrollmentDate: "",
    birthdate: "",
    guardianNames: "",
    motivationScore: 60,
  });

  const enriched = useMemo(() => {
    return data.map((student) => {
      const logs = getConversationsByStudentId(student.id);
      const lastLog = logs.sort((a, b) => (a.date < b.date ? 1 : -1))[0];
      const daysSinceLast = lastLog
        ? Math.floor(
            (Date.now() - new Date(lastLog.date).getTime()) / (1000 * 60 * 60 * 24)
          )
        : null;
      const completeness = getProfileCompleteness(student.profile);
      return {
        ...student,
        conversationCount: logs.length,
        lastConversationDate: lastLog?.date ?? "",
        daysSinceLast,
        completeness,
      };
    });
  }, [data]);

  const filtered = useMemo(() => {
    const base = keyword
      ? enriched.filter(
          (s) =>
            s.name.includes(keyword) ||
            (s.nameKana ?? "").includes(keyword) ||
            s.teacher.includes(keyword)
        )
      : enriched;
    if (sortKey === "latest") {
      return [...base].sort((a, b) => (a.lastConversationDate < b.lastConversationDate ? 1 : -1));
    }
    if (sortKey === "oldest") {
      return [...base].sort((a, b) => (a.lastConversationDate > b.lastConversationDate ? 1 : -1));
    }
    return [...base].sort((a, b) => (b.conversationCount ?? 0) - (a.conversationCount ?? 0));
  }, [enriched, keyword, sortKey]);

  return (
    <div>
      <AppHeader
        title="生徒一覧"
        subtitle="最終会話・ログ件数・カルテ充実度を軸に優先度を決める"
        actions={
          <input
            className={styles.search}
            placeholder="名前・担当で検索"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
        }
      />

      <Card>
        <div className={styles.tabContent}>
          <div className={styles.headerRow}>
            <div>
              <div className={styles.title}>生徒一覧</div>
              <div className={styles.subtitle}>
                会話が多いほどカルテが充実。最終会話が古い順にフォローを推奨。
              </div>
            </div>
            <div className={styles.actionsRow}>
              <select
                className={styles.select}
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value as SortKey)}
              >
                <option value="latest">最終会話が新しい順</option>
                <option value="oldest">最終会話が古い順</option>
                <option value="logCount">会話ログが多い順</option>
              </select>
              <Button size="small" variant="secondary" onClick={() => setShowNewForm((v) => !v)}>
                <Icon name="plus" /> 生徒を追加
              </Button>
            </div>
          </div>

          {showNewForm && (
            <div
              className={styles.overlay}
              role="dialog"
              aria-modal="true"
              onMouseDown={() => setShowNewForm(false)}
            >
              <div className={styles.modal} onMouseDown={(e) => e.stopPropagation()}>
                <div className={styles.modalHeader}>
                  <div>
                    <div className={styles.modalTitle}>
                      <Icon name="plus" /> 新規生徒登録
                    </div>
                    <div className={styles.modalSubtitle}>
                      必須: 氏名 / フリガナ / 学年（残りは任意）。会話ログは生徒詳細で追加します。
                    </div>
                  </div>
                  <button
                    type="button"
                    className={styles.closeButton}
                    onClick={() => setShowNewForm(false)}
                    aria-label="閉じる"
                  >
                    ×
                  </button>
                </div>

                <div className={styles.formGrid}>
                  <div className={styles.field}>
                    <label className={styles.formLabel}>
                      氏名 <span className={styles.required}>必須</span>
                    </label>
                    <input
                      className={styles.input}
                      value={newStudent.name}
                      onChange={(e) => setNewStudent((p) => ({ ...p, name: e.target.value }))}
                      placeholder="例）佐藤 太郎"
                    />
                  </div>
                  <div className={styles.field}>
                    <label className={styles.formLabel}>
                      フリガナ（カタカナ） <span className={styles.required}>必須</span>
                    </label>
                    <input
                      className={styles.input}
                      value={newStudent.nameKana}
                      onChange={(e) => setNewStudent((p) => ({ ...p, nameKana: e.target.value }))}
                      placeholder="例）サトウ タロウ"
                    />
                  </div>
                  <div className={styles.field}>
                    <label className={styles.formLabel}>
                      学年 <span className={styles.required}>必須</span>
                    </label>
                    <input
                      className={styles.input}
                      value={newStudent.grade}
                      onChange={(e) => setNewStudent((p) => ({ ...p, grade: e.target.value }))}
                      placeholder="例）高校1年"
                    />
                  </div>
                  <div className={styles.field}>
                    <label className={styles.formLabel}>入塾日</label>
                    <input
                      className={styles.input}
                      type="date"
                      value={newStudent.enrollmentDate}
                      onChange={(e) => setNewStudent((p) => ({ ...p, enrollmentDate: e.target.value }))}
                    />
                  </div>
                  <div className={styles.field}>
                    <label className={styles.formLabel}>生年月日</label>
                    <input
                      className={styles.input}
                      type="date"
                      value={newStudent.birthdate}
                      onChange={(e) => setNewStudent((p) => ({ ...p, birthdate: e.target.value }))}
                    />
                  </div>
                  <div className={styles.field}>
                    <label className={styles.formLabel}>保護者（氏名）</label>
                    <input
                      className={styles.input}
                      value={newStudent.guardianNames}
                      onChange={(e) => setNewStudent((p) => ({ ...p, guardianNames: e.target.value }))}
                      placeholder="例）父: 佐藤一郎 / 母: 佐藤花子"
                    />
                  </div>
                </div>

                <div className={styles.modalFooter}>
                  <div className={styles.footerNote}>
                    <Icon name="info" /> 登録後、生徒詳細で「録音→会話ログ→カルテ更新」ができます
                  </div>
                  <div className={styles.footerActions}>
                    <Button variant="secondary" onClick={() => setShowNewForm(false)}>
                      キャンセル
                    </Button>
                    <Button
                      variant="primary"
                      onClick={() => {
                        if (!newStudent.name || !newStudent.nameKana || !newStudent.grade) return;
                        const id = `s-new-${Date.now()}`;
                        const created = {
                          id,
                          name: newStudent.name,
                          nameKana: newStudent.nameKana,
                          grade: newStudent.grade,
                          course: "",
                          enrollmentDate: newStudent.enrollmentDate,
                          birthdate: newStudent.birthdate,
                          guardianNames: newStudent.guardianNames,
                          lastConversationDate: "",
                          conversationCount: 0,
                          motivationScore: newStudent.motivationScore,
                          teacher: DEFAULT_TEACHER_FULL_NAME,
                          profile: {
                            summary: "新規登録された生徒です。会話ログを追加してカルテを育ててください。",
                            personal: {},
                            basics: {},
                            aiTodos: [],
                          },
                          motivationHistory: [],
                          events: [],
                          studyPlan: [],
                        };
                        setData((prev) => [created, ...prev]);
                        setShowNewForm(false);
                        setNewStudent({
                          name: "",
                          nameKana: "",
                          grade: "",
                          enrollmentDate: "",
                          birthdate: "",
                          guardianNames: "",
                          motivationScore: 60,
                        });
                        router.push(`/app/students/${id}`);
                      }}
                    >
                      <Icon name="plus" /> 登録してカルテへ
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}

          <Card
            title={
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Icon name="list" /> 生徒リスト
              </span>
            }
            subtitle={`${filtered.length}名の生徒`}
          >
            <div className={styles.tableWrapper}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>生徒名 / 学年</th>
                    <th>最終会話から</th>
                    <th>会話ログ件数</th>
                    <th>カルテ充実度</th>
                    <th>担当</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={5} style={{ textAlign: "center", padding: 40, color: "var(--muted)" }}>
                        該当する生徒が見つかりませんでした
                      </td>
                    </tr>
                  ) : (
                    filtered.map((student) => (
                      <tr
                        key={student.id}
                        className={styles.row}
                        onClick={() => router.push(`/app/students/${student.id}`)}
                      >
                        <td style={{ fontWeight: 700 }}>
                          {student.name}
                          {student.nameKana ? <div className={styles.subtext}>{student.nameKana}</div> : null}
                          <div className={styles.subtext}>{student.grade}</div>
                        </td>
                        <td>
                          {student.daysSinceLast != null ? (
                            <span>
                              {student.daysSinceLast} 日
                              <div className={styles.subtext}>{student.lastConversationDate}</div>
                            </span>
                          ) : (
                            <span className={styles.subtext}>未会話</span>
                          )}
                        </td>
                        <td>
                          <span style={{ fontWeight: 700 }}>{student.conversationCount ?? 0} 件</span>
                        </td>
                        <td>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span>{student.completeness ?? 0}%</span>
                            <Progress value={student.completeness ?? 0} />
                          </div>
                        </td>
                        <td>{student.teacher}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      </Card>
    </div>
  );
}
