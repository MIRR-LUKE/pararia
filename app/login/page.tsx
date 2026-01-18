"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./login.module.css";
import { Button } from "@/components/ui/Button";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("demo@pararia.app");
  const [password, setPassword] = useState("password");

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    router.push("/app/dashboard");
  };

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.title}>PARARIA AI</h1>
        <p className={styles.subtitle}>学習塾向け AIダッシュボード（デモ）</p>
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
          <div className={styles.actions}>
            <Button type="submit" variant="primary">
              ログイン
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => router.push("/app/dashboard")}
            >
              デモを見る
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
