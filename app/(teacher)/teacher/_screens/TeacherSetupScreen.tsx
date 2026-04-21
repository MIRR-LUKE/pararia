"use client";

import { FormEvent, useState } from "react";
import { Button } from "@/components/ui/Button";
import styles from "../teacher.module.css";

export function TeacherSetupScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [deviceLabel, setDeviceLabel] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    const response = await fetch("/api/teacher/auth/device-login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email,
        password,
        deviceLabel,
      }),
    });
    const body = await response.json().catch(() => ({}));
    setSubmitting(false);
    if (!response.ok) {
      setError(typeof body?.error === "string" ? body.error : "端末設定に失敗しました。");
      return;
    }
    window.location.assign("/teacher");
  };

  return (
    <div className={styles.authCard}>
      <div className={styles.eyebrow}>PARARIA Teacher App</div>
      <h1 className={styles.title}>校舎端末の設定</h1>
      <p className={styles.description}>初回だけ、管理者または室長のアカウントでこの端末を登録します。</p>
      <form className={styles.form} onSubmit={onSubmit}>
        <label className={styles.field}>
          <span>メールアドレス</span>
          <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" required />
        </label>
        <label className={styles.field}>
          <span>パスワード</span>
          <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" required />
        </label>
        <label className={styles.field}>
          <span>端末名</span>
          <input
            value={deviceLabel}
            onChange={(event) => setDeviceLabel(event.target.value)}
            placeholder="例: 渋谷校 iPhone"
            required
          />
        </label>
        {error ? <p className={styles.error}>{error}</p> : null}
        <Button type="submit" className={styles.primaryButton} disabled={submitting}>
          {submitting ? "設定しています..." : "端末を登録する"}
        </Button>
      </form>
    </div>
  );
}
