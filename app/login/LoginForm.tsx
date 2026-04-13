"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import styles from "./login.module.css";
import { Button } from "@/components/ui/Button";

type Props = {
  callbackUrl: string;
};

export function LoginForm({ callbackUrl }: Props) {
  const router = useRouter();
  const [email, setEmail] = useState("admin@demo.com");
  const [password, setPassword] = useState("demo123");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;
    let attempts = 0;

    const prefetch = () => {
      if (cancelled || attempts >= 4) return;
      router.prefetch(callbackUrl);
      attempts += 1;
      if (attempts < 4) {
        timer = window.setTimeout(prefetch, 700);
      }
    };

    prefetch();

    return () => {
      cancelled = true;
      if (timer !== null) {
        window.clearTimeout(timer);
      }
    };
  }, [callbackUrl, router]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
      callbackUrl,
    });
    setSubmitting(false);

    if (result?.error) {
      setError("ログインに失敗しました。メールアドレスとパスワードを確認してください。");
      return;
    }

    window.location.assign(result?.url || callbackUrl);
  };

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.title}>PARARIA</h1>
        <p className={styles.subtitle}>面談と指導報告を、次の会話に使える運用データへ。</p>
        <form onSubmit={onSubmit}>
          <div className={styles.field}>
            <label className={styles.label}>メールアドレス</label>
            <input
              className={styles.input}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>パスワード</label>
            <input
              className={styles.input}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          {error ? <p className={styles.errorText}>{error}</p> : null}
          <div className={styles.actions}>
            <Button type="submit" variant="primary" disabled={submitting}>
              {submitting ? "ログイン中..." : "ログイン"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
