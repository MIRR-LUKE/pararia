"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AppHeader } from "@/components/layout/AppHeader";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import styles from "./settings.module.css";

type MissingStudent = {
  id: string;
  name: string;
  grade?: string | null;
  guardianNames?: string | null;
};

type SettingsResponse = {
  organization: {
    id: string;
    name: string;
    createdAt: string;
    updatedAt: string;
  };
  permissions: {
    viewerRole?: string;
    canManage: boolean;
    roleCounts: Record<string, number>;
  };
  guardianContacts: {
    totalStudents: number;
    studentsWithGuardian: number;
    studentsMissingGuardian: number;
    coveragePercent: number;
    missingStudents: MissingStudent[];
  };
  sending: {
    provider: "resend" | "postmark" | "none";
    manualShareEnabled: boolean;
    emailConfigured: boolean;
    lineConfigured: boolean;
    emailStatusLabel: string;
    lineStatusLabel: string;
  };
  trust: {
    transcriptRetentionDays: number;
    reportDeliveryEventRetentionDays: number;
    guardianNoticeRequired: boolean;
    deletionRequestFlow: string;
  };
};

async function fetchSettingsData() {
  const res = await fetch("/api/settings", { cache: "no-store" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body?.error ?? "設定の読み込みに失敗しました。");
  }
  return body as SettingsResponse;
}

function toGuardianDrafts(students: MissingStudent[]) {
  return Object.fromEntries(students.map((student) => [student.id, student.guardianNames ?? ""]));
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<SettingsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [organizationName, setOrganizationName] = useState("");
  const [savingOrganization, setSavingOrganization] = useState(false);
  const [savingGuardianId, setSavingGuardianId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [guardianDrafts, setGuardianDrafts] = useState<Record<string, string>>({});

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const body = await fetchSettingsData();
        setSettings(body);
        setOrganizationName(body.organization.name);
        setGuardianDrafts(toGuardianDrafts(body.guardianContacts.missingStudents));
      } catch (nextError: any) {
        setError(nextError?.message ?? "設定の読み込みに失敗しました。");
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, []);

  const permissionRows = useMemo(() => {
    if (!settings) return [];
    return [
      { label: "Admin", value: settings.permissions.roleCounts.ADMIN ?? 0 },
      { label: "Manager", value: settings.permissions.roleCounts.MANAGER ?? 0 },
      { label: "Teacher", value: settings.permissions.roleCounts.TEACHER ?? 0 },
      { label: "Instructor", value: settings.permissions.roleCounts.INSTRUCTOR ?? 0 },
    ];
  }, [settings]);

  const refreshSettings = async (successMessage?: string) => {
    const refreshed = await fetchSettingsData();
    setSettings(refreshed);
    setOrganizationName(refreshed.organization.name);
    setGuardianDrafts(toGuardianDrafts(refreshed.guardianContacts.missingStudents));
    if (successMessage) setMessage(successMessage);
  };

  const saveOrganizationName = async () => {
    if (!organizationName.trim()) return;
    setSavingOrganization(true);
    setMessage(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationName }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? "組織名の更新に失敗しました。");
      await refreshSettings("組織名を更新しました。");
    } catch (nextError: any) {
      setMessage(nextError?.message ?? "組織名の更新に失敗しました。");
    } finally {
      setSavingOrganization(false);
    }
  };

  const saveGuardianNames = async (studentId: string) => {
    const guardianNames = guardianDrafts[studentId]?.trim() ?? "";
    if (!guardianNames) {
      setMessage("guardianNames を入力してください。");
      return;
    }

    setSavingGuardianId(studentId);
    setMessage(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId, guardianNames }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? "guardianNames の更新に失敗しました。");
      await refreshSettings(`guardianNames を更新しました: ${body.student?.name ?? "生徒"}`);
    } catch (nextError: any) {
      setMessage(nextError?.message ?? "guardianNames の更新に失敗しました。");
    } finally {
      setSavingGuardianId(null);
    }
  };

  if (loading) {
    return <div className={styles.page}>設定を読み込み中です。</div>;
  }

  if (error || !settings) {
    return (
      <div className={styles.page}>
        <div className={styles.errorBox}>
          <strong>設定を開けませんでした</strong>
          <p>{error ?? "設定の読み込みに失敗しました。"}</p>
        </div>
      </div>
    );
  }

  const canManage = settings.permissions.canManage;

  return (
    <div className={styles.page}>
      <AppHeader
        title="システム設定"
        subtitle="組織名、guardian 連絡先、送信設定の現状、権限人数、保存期間をここで確認します。"
      />

      <div className={styles.grid}>
        <Card
          title="組織設定"
          subtitle="まずは組織名だけをここで更新できます。より細かい設定は次の段階で広げます。"
        >
          <div className={styles.field}>
            <label className={styles.label}>組織名</label>
            <input
              className={styles.input}
              value={organizationName}
              onChange={(event) => setOrganizationName(event.target.value)}
              disabled={!canManage}
            />
            <div className={styles.note}>
              最終更新: {new Date(settings.organization.updatedAt).toLocaleString("ja-JP")}
            </div>
          </div>
          <div className={styles.buttonRow}>
            <Button
              onClick={saveOrganizationName}
              disabled={savingOrganization || !canManage || !organizationName.trim()}
            >
              {savingOrganization ? "保存中..." : "組織名を保存"}
            </Button>
            {!canManage ? <span className={styles.note}>このアカウントでは編集できません。</span> : null}
          </div>
          {message ? <div className={styles.note}>{message}</div> : null}
        </Card>

        <Card
          title="guardian 連絡先"
          subtitle="未入力の生徒だけをここに出して、その場で guardianNames を埋められるようにしています。"
        >
          <div className={styles.metricGrid}>
            <div className={styles.metricCard}>
              <span className={styles.metricLabel}>入力済み</span>
              <strong>{settings.guardianContacts.studentsWithGuardian}</strong>
            </div>
            <div className={styles.metricCard}>
              <span className={styles.metricLabel}>未入力</span>
              <strong>{settings.guardianContacts.studentsMissingGuardian}</strong>
            </div>
            <div className={styles.metricCard}>
              <span className={styles.metricLabel}>カバレッジ</span>
              <strong>{settings.guardianContacts.coveragePercent}%</strong>
            </div>
          </div>

          <div className={styles.listBlock}>
            {settings.guardianContacts.missingStudents.length === 0 ? (
              <div className={styles.successBox}>
                guardian 連絡先が未入力の生徒はいません。
              </div>
            ) : (
              settings.guardianContacts.missingStudents.map((student) => (
                <div key={student.id} className={styles.studentEditor}>
                  <div className={styles.studentHeader}>
                    <div>
                      <strong>{student.name}</strong>
                      <div className={styles.note}>{student.grade ? `学年: ${student.grade}` : "学年未設定"}</div>
                    </div>
                    <Link href={`/app/students/${student.id}`} className={styles.inlineLink}>
                      Student Room を開く
                    </Link>
                  </div>
                  <label className={styles.label}>guardianNames</label>
                  <input
                    className={styles.input}
                    value={guardianDrafts[student.id] ?? ""}
                    onChange={(event) =>
                      setGuardianDrafts((current) => ({
                        ...current,
                        [student.id]: event.target.value,
                      }))
                    }
                    placeholder="例: 山田 太郎 / 山田 花子"
                    disabled={!canManage}
                  />
                  <div className={styles.buttonRow}>
                    <Button
                      onClick={() => saveGuardianNames(student.id)}
                      disabled={!canManage || savingGuardianId === student.id || !(guardianDrafts[student.id] ?? "").trim()}
                    >
                      {savingGuardianId === student.id ? "保存中..." : "guardianNames を保存"}
                    </Button>
                    {!canManage ? <span className={styles.note}>このアカウントでは編集できません。</span> : null}
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>

        <Card
          title="送信設定"
          subtitle="この画面では現状確認のみ行います。実際の送信プロバイダや LINE 設定は環境変数と本実装側で管理しています。"
        >
          <div className={styles.readOnlyBanner}>
            <strong>参照専用</strong>
            <p>ここでは設定値の確認だけを行い、変更はまだ受け付けません。</p>
          </div>
          <div className={styles.policyList}>
            <div className={styles.policyItem}>
              <strong>メール送信</strong>
              <p>{settings.sending.emailStatusLabel}</p>
            </div>
            <div className={styles.policyItem}>
              <strong>手動共有</strong>
              <p>{settings.sending.manualShareEnabled ? "利用可能" : "未対応"}</p>
            </div>
            <div className={styles.policyItem}>
              <strong>LINE 第二チャネル</strong>
              <p>{settings.sending.lineStatusLabel}</p>
            </div>
          </div>
        </Card>

        <Card
          title="権限と人数"
          subtitle="誰がどの設定を更新できるかを、まずは人数で把握できるようにしています。"
        >
          <div className={styles.listBlock}>
            {permissionRows.map((row) => (
              <div key={row.label} className={styles.listRow}>
                <span>{row.label}</span>
                <strong>{row.value}</strong>
              </div>
            ))}
          </div>
          <div className={styles.note}>
            現在のロール: {settings.permissions.viewerRole ?? "未設定"} / 編集権限:{" "}
            {canManage ? "可能" : "なし"}
          </div>
        </Card>

        <Card
          title="保存期間と通知"
          subtitle="削除や保存の運用ポリシーを、ここで確認できるようにしています。"
        >
          <div className={styles.listBlock}>
            <div className={styles.listRow}>
              <span>transcript 保存期間</span>
              <strong>{settings.trust.transcriptRetentionDays} 日</strong>
            </div>
            <div className={styles.listRow}>
              <span>delivery event 保存期間</span>
              <strong>{settings.trust.reportDeliveryEventRetentionDays} 日</strong>
            </div>
            <div className={styles.listRow}>
              <span>guardian 通知</span>
              <strong>{settings.trust.guardianNoticeRequired ? "必要" : "任意"}</strong>
            </div>
            <div className={styles.listRow}>
              <span>削除依頼フロー</span>
              <strong>{settings.trust.deletionRequestFlow}</strong>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
