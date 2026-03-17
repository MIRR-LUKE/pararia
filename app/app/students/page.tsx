"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AppHeader } from "@/components/layout/AppHeader";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import styles from "./students.module.css";

type SessionSummary = {
  id: string;
  status: string;
  type: "INTERVIEW" | "LESSON_REPORT";
  sessionDate: string;
  heroStateLabel?: string | null;
  heroOneLiner?: string | null;
  latestSummary?: string | null;
  pendingEntityCount: number;
};

type ReportSummary = {
  id: string;
  status: string;
  createdAt: string;
  sentAt?: string | null;
};

type StudentRow = {
  id: string;
  name: string;
  nameKana?: string | null;
  grade?: string | null;
  course?: string | null;
  guardianNames?: string | null;
  profiles?: Array<{ profileData?: any }>;
  sessions?: SessionSummary[];
  reports?: ReportSummary[];
  _count?: { sessions: number; reports: number };
};

type ViewKey = "all" | "interview" | "review" | "report";

function completeness(profileData?: any) {
  const basic = Array.isArray(profileData?.basic) ? profileData.basic.length : 0;
  const personal = Array.isArray(profileData?.personal) ? profileData.personal.length : 0;
  return Math.min(100, (basic + personal) * 6);
}

function summarize(student: StudentRow) {
  const latestSession = student.sessions?.[0];
  const latestReport = student.reports?.[0];

  if (!latestSession) {
    return {
      state: "未開始",
      oneLiner: "まだ会話データがありません。最初の面談から始めます。",
      nextAction: "最初の面談を録音",
      href: `/app/students/${student.id}?panel=recording&mode=INTERVIEW`,
      view: "interview" as const,
    };
  }

  if (latestSession.type === "LESSON_REPORT" && latestSession.status === "COLLECTING") {
    return {
      state: latestSession.heroStateLabel ?? "授業途中",
      oneLiner:
        latestSession.heroOneLiner ?? "授業前の記録だけ保存されています。授業後の録音で完了します。",
      nextAction: "チェックアウトを録る",
      href: `/app/students/${student.id}?panel=recording&mode=LESSON_REPORT&part=CHECK_OUT`,
      view: "all" as const,
    };
  }

  if (latestSession.pendingEntityCount > 0) {
    return {
      state: latestSession.heroStateLabel ?? "要確認",
      oneLiner: latestSession.heroOneLiner ?? latestSession.latestSummary ?? "確認が必要な固有名詞があります。",
      nextAction: "要確認を開く",
      href: `/app/students/${student.id}`,
      view: "review" as const,
    };
  }

  if (latestReport && latestReport.status !== "SENT") {
    return {
      state: latestSession.heroStateLabel ?? "確認待ち",
      oneLiner: latestSession.heroOneLiner ?? latestSession.latestSummary ?? "保護者レポートの確認待ちがあります。",
      nextAction: "レポを確認",
      href: `/app/students/${student.id}?panel=report`,
      view: "report" as const,
    };
  }

  return {
    state: latestSession.heroStateLabel ?? "更新済み",
    oneLiner:
      latestSession.heroOneLiner ?? latestSession.latestSummary ?? "次の会話に向けた材料が揃っています。",
    nextAction: "生徒ルームへ",
    href: `/app/students/${student.id}`,
    view: "all" as const,
  };
}

export default function StudentsPage() {
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<ViewKey>("all");
  const [showCreate, setShowCreate] = useState(false);
  const [newStudent, setNewStudent] = useState({
    name: "",
    nameKana: "",
    grade: "",
    course: "",
    guardianNames: "",
  });

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/students", { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "生徒一覧の取得に失敗しました。");
      setStudents(body.students ?? []);
    } catch (err: any) {
      setError(err?.message ?? "生徒一覧の取得に失敗しました。");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const rows = useMemo(() => {
    return students.map((student) => {
      const summary = summarize(student);
      return {
        ...student,
        completeness: completeness(student.profiles?.[0]?.profileData),
        state: summary.state,
        oneLiner: summary.oneLiner,
        nextAction: summary.nextAction,
        href: summary.href,
        viewKey: summary.view,
      };
    });
  }, [students]);

  const filtered = useMemo(() => {
    const lowered = query.trim().toLowerCase();
    return rows.filter((student) => {
      const latestSession = student.sessions?.[0];
      const latestReport = student.reports?.[0];
      const matchesView =
        view === "all"
          ? true
          : view === "interview"
            ? !latestSession
            : view === "review"
              ? (latestSession?.pendingEntityCount ?? 0) > 0
              : Boolean(latestReport && latestReport.status !== "SENT");

      if (!matchesView) return false;
      if (!lowered) return true;
      return [student.name, student.nameKana, student.grade, student.course]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(lowered));
    });
  }, [query, rows, view]);

  const createStudent = async () => {
    if (!newStudent.name.trim() || !newStudent.nameKana.trim() || !newStudent.grade.trim()) {
      alert("生徒名、フリガナ、学年は必須です。");
      return;
    }

    const res = await fetch("/api/students", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: newStudent.name.trim(),
        nameKana: newStudent.nameKana.trim(),
        grade: newStudent.grade.trim(),
        course: newStudent.course.trim() || undefined,
        guardianNames: newStudent.guardianNames.trim() || undefined,
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(body?.error ?? "生徒の作成に失敗しました。");
      return;
    }

    setShowCreate(false);
    setNewStudent({ name: "", nameKana: "", grade: "", course: "", guardianNames: "" });
    await refresh();
  };

  return (
    <div className={styles.page}>
      <AppHeader
        title="Students"
        subtitle="ここは全生徒ディレクトリです。探して入り、状態を見て、必要ならそのまま面談や授業へ進みます。"
        actions={
          <Button variant="secondary" onClick={() => setShowCreate((prev) => !prev)}>
            生徒を追加
          </Button>
        }
      />

      <section className={styles.toolbar}>
        <input
          className={styles.search}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="名前、フリガナ、学年、コースで検索"
        />
        <div className={styles.filters}>
          {[
            { key: "all", label: "すべて" },
            { key: "interview", label: "面談待ち" },
            { key: "review", label: "要確認" },
            { key: "report", label: "レポ待ち" },
          ].map((item) => (
            <button
              key={item.key}
              type="button"
              className={`${styles.filterChip} ${view === item.key ? styles.filterChipActive : ""}`}
              onClick={() => setView(item.key as ViewKey)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </section>

      {showCreate && (
        <Card title="新しい生徒を追加" subtitle="最小限の情報だけ入れて、あとから会話でプロフィールを育てます。">
          <div className={styles.formGrid}>
            <input
              value={newStudent.name}
              onChange={(event) => setNewStudent((prev) => ({ ...prev, name: event.target.value }))}
              placeholder="生徒名"
            />
            <input
              value={newStudent.nameKana}
              onChange={(event) => setNewStudent((prev) => ({ ...prev, nameKana: event.target.value }))}
              placeholder="フリガナ"
            />
            <input
              value={newStudent.grade}
              onChange={(event) => setNewStudent((prev) => ({ ...prev, grade: event.target.value }))}
              placeholder="学年"
            />
            <input
              value={newStudent.course}
              onChange={(event) => setNewStudent((prev) => ({ ...prev, course: event.target.value }))}
              placeholder="コース"
            />
            <input
              value={newStudent.guardianNames}
              onChange={(event) => setNewStudent((prev) => ({ ...prev, guardianNames: event.target.value }))}
              placeholder="保護者名"
            />
          </div>
          <div className={styles.formActions}>
            <Button variant="secondary" onClick={() => setShowCreate(false)}>
              閉じる
            </Button>
            <Button onClick={createStudent}>追加する</Button>
          </div>
        </Card>
      )}

      <Card title="生徒ディレクトリ" subtitle="今日の緊急度ではなく、探しやすさと次の行動の分かりやすさを優先します。">
        {error && <div className={styles.error}>{error}</div>}
        {loading ? (
          <div className={styles.empty}>読み込み中です。</div>
        ) : filtered.length === 0 ? (
          <div className={styles.emptyState}>
            <strong>条件に合う生徒がいません</strong>
            <p>検索条件を変えるか、新しい生徒を追加してください。</p>
          </div>
        ) : (
          <div className={styles.list}>
            {filtered.map((student) => (
              <Link key={student.id} href={student.href} className={styles.row}>
                <div className={styles.rowIdentity}>
                  <div className={styles.rowTop}>
                    <strong className={styles.rowName}>{student.name}</strong>
                    {student.grade ? <span className={styles.meta}>{student.grade}</span> : null}
                    <Badge label={student.state} tone={student.sessions?.[0]?.pendingEntityCount ? "high" : "medium"} />
                  </div>
                  <p className={styles.oneLiner}>{student.oneLiner}</p>
                </div>

                <div className={styles.rowMetaColumn}>
                  <div>
                    <div className={styles.metaLabel}>次にやること</div>
                    <div className={styles.metaValue}>{student.nextAction}</div>
                  </div>
                  <div>
                    <div className={styles.metaLabel}>プロフィール</div>
                    <div className={styles.metaValue}>{student.completeness}%</div>
                  </div>
                </div>

                <div className={styles.rowMetaColumn}>
                  <div>
                    <div className={styles.metaLabel}>セッション</div>
                    <div className={styles.metaValue}>{student._count?.sessions ?? 0} 件</div>
                  </div>
                  <div>
                    <div className={styles.metaLabel}>レポート</div>
                    <div className={styles.metaValue}>{student._count?.reports ?? 0} 件</div>
                  </div>
                </div>

                <div className={styles.rowAction}>
                  <Button>{student.nextAction}</Button>
                </div>
              </Link>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
