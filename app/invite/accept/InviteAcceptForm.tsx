"use client";

import { FormEvent, useMemo, useState } from "react";
import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/Button";
import styles from "@/app/login/login.module.css";

type Props = {
  token: string;
};

export function InviteAcceptForm({ token }: Props) {
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const emailHint = useMemo(() => "登録完了後、ログイン画面でメールアドレスとパスワードを入力してください。", []);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password !== password2) {
      setError("パスワードが一致しません。");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/invitations/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, name, password }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body?.error ?? "登録に失敗しました。");
        setSubmitting(false);
        return;
      }
      const email = body.email as string;
      const sign = await signIn("credentials", {
        email,
        password,
        redirect: false,
        callbackUrl: "/app/dashboard",
      });
      if (sign?.error) {
        window.location.assign(`/login?callbackUrl=${encodeURIComponent("/app/dashboard")}`);
        return;
      }
      window.location.assign(sign?.url || "/app/dashboard");
    } catch {
      setError("通信に失敗しました。");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.title}>招待を受け取る</h1>
        <p className={styles.subtitle}>組織からの招待リンクです。表示名とパスワードを設定して利用を開始します。</p>
        <form onSubmit={onSubmit}>
          <div className={styles.field}>
            <label className={styles.label}>表示名</label>
            <input className={styles.input} value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>パスワード（8文字以上）</label>
            <input
              className={styles.input}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>パスワード（確認）</label>
            <input
              className={styles.input}
              type="password"
              value={password2}
              onChange={(e) => setPassword2(e.target.value)}
              required
              minLength={8}
            />
          </div>
          {error ? <p className={styles.errorText}>{error}</p> : null}
          <p className={styles.subtitle}>{emailHint}</p>
          <div className={styles.actions}>
            <Button type="submit" variant="primary" disabled={submitting}>
              {submitting ? "登録中..." : "アカウントを有効化"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
