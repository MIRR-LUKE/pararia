"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AppHeader } from "@/components/layout/AppHeader";
import { Card } from "@/components/ui/Card";
import { Progress } from "@/components/ui/Progress";
import styles from "./students.module.css";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { DEFAULT_TEACHER_FULL_NAME } from "@/lib/constants";

type SortKey = "latest" | "oldest" | "logCount";

type StudentRow = {
  id: string;
  name: string;
  grade?: string | null;
  course?: string | null;
  guardianNames?: string | null;
  lastConversationDate?: string | null;
  conversationCount: number;
  completeness: number;
};

function calcCompleteness(profileData?: any) {
  const basic = profileData?.basic ?? [];
  const personal = profileData?.personal ?? [];
  const total = (basic?.length ?? 0) + (personal?.length ?? 0);
  return Math.min(100, total * 6);
}

export default function StudentsPage() {
  const router = useRouter();
  const [data, setData] = useState<StudentRow[]>([]);
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
  });

  const refresh = async () => {
    try {
      const res = await fetch("/api/students");
      if (!res.ok) return;
      const json = await res.json();
      const rows: StudentRow[] = (json.students ?? []).map((s: any) => {
        const lastConversation = s.conversations?.[0]?.createdAt ?? null;
        const profileData = s.profiles?.[0]?.profileData ?? {};
        return {
          id: s.id,
          name: s.name,
          grade: s.grade,
          course: s.course,
          guardianNames: s.guardianNames,
          lastConversationDate: lastConversation,
          conversationCount: s._count?.conversations ?? 0,
          completeness: calcCompleteness(profileData),
        };
      });
      setData(rows);
    } catch (e) {
      console.error("[StudentsPage] fetch failed", e);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const filtered = useMemo(() => {
    const base = keyword
      ? data.filter((s) => s.name.includes(keyword) || (s.grade ?? "").includes(keyword))
      : data;
    if (sortKey === "latest") {
      return [...base].sort((a, b) => (a.lastConversationDate ?? "") < (b.lastConversationDate ?? "") ? 1 : -1);
    }
    if (sortKey === "oldest") {
      return [...base].sort((a, b) => (a.lastConversationDate ?? "") > (b.lastConversationDate ?? "") ? 1 : -1);
    }
    return [...base].sort((a, b) => (b.conversationCount ?? 0) - (a.conversationCount ?? 0));
  }, [data, keyword, sortKey]);

  return (
    <div>
      <AppHeader
        title="生徒一覧"
        subtitle="最終会話・ログ件数・カルテ充実度を軸に優先度を決める"
        actions={
          <input
            className={styles.search}
            placeholder="名前・学年で検索"
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
                      onClick={async () => {
                        if (!newStudent.name || !newStudent.nameKana || !newStudent.grade) {
                          alert("氏名・フリガナ・学年は必須です");
                          return;
                        }
                        const res = await fetch("/api/students", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            organizationId: "org-demo",
                            name: newStudent.name,
                            nameKana: newStudent.nameKana,
                            grade: newStudent.grade,
                            course: "",
                            enrollmentDate: newStudent.enrollmentDate,
                            birthdate: newStudent.birthdate,
                            guardianNames: newStudent.guardianNames,
                          }),
                        });
                        if (!res.ok) {
                          const err = await res.json().catch(() => ({}));
                          alert(err.error ?? "生徒追加に失敗しました");
                          return;
                        }
                        const data = await res.json();
                        setShowNewForm(false);
                        setNewStudent({
                          name: "",
                          nameKana: "",
                          grade: "",
                          enrollmentDate: "",
                          birthdate: "",
                          guardianNames: "",
                        });
                        await refresh();
                        router.push(`/app/students/${data.student.id}`);
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
                    <th>最終会話</th>
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
                          <div className={styles.subtext}>{student.grade}</div>
                        </td>
                        <td>
                          {student.lastConversationDate ? (
                            <span>
                              {new Date(student.lastConversationDate).toLocaleDateString("ja-JP")}
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
                        <td>{DEFAULT_TEACHER_FULL_NAME}</td>
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
