"use client";

import { FormEvent, useState } from "react";
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

    router.push(result?.url || callbackUrl);
    router.refresh();
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
          {error ? <p className={styles.subtitle} style={{ color: "#b91c1c" }}>{error}</p> : null}
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