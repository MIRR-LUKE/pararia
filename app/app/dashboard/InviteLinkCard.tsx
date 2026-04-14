"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import styles from "./dashboard.module.css";

export default function InviteLinkCard() {
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteMessage, setInviteMessage] = useState<string | null>(null);

  return (
    <Card
      title="ユーザーを招待"
      subtitle="公開サインアップはありません。管理者・室長が招待リンクを発行し、相手に初回パスワードを設定してもらいます。"
    >
      <div className={styles.inviteRow}>
        <input
          className={styles.inviteInput}
          type="email"
          placeholder="招待するメールアドレス"
          value={inviteEmail}
          onChange={(event) => setInviteEmail(event.target.value)}
        />
        <Button
          onClick={async () => {
            setInviteBusy(true);
            setInviteMessage(null);
            try {
              const res = await fetch("/api/invitations", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email: inviteEmail, role: "TEACHER" }),
              });
              const body = await res.json();
              if (!res.ok) {
                setInviteMessage(body?.error ?? "招待の作成に失敗しました。");
                return;
              }
              setInviteMessage(`招待 URL を発行しました。相手にそのまま共有してください。\n${body.inviteUrl ?? ""}`);
              setInviteEmail("");
            } catch {
              setInviteMessage("通信に失敗しました。");
            } finally {
              setInviteBusy(false);
            }
          }}
          disabled={inviteBusy || !inviteEmail.trim()}
        >
          {inviteBusy ? "作成中..." : "招待リンクを作成"}
        </Button>
      </div>
      {inviteMessage ? <p className={styles.inviteMessage}>{inviteMessage}</p> : null}
    </Card>
  );
}
