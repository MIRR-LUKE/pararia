import Link from "next/link";

export default function NotFound() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: "32px",
        background: "#f4f7fb",
        color: "#122033",
      }}
    >
      <div style={{ maxWidth: "420px", display: "grid", gap: "12px", textAlign: "center" }}>
        <p style={{ margin: 0, fontSize: "12px", fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase" }}>
          Not Found
        </p>
        <h1 style={{ margin: 0, fontSize: "28px", lineHeight: 1.2 }}>ページが見つかりません</h1>
        <p style={{ margin: 0, fontSize: "14px", lineHeight: 1.7, color: "#4e6179" }}>
          URL が変わったか、削除された可能性があります。ダッシュボードから必要な画面へ戻ってください。
        </p>
        <div style={{ paddingTop: "8px" }}>
          <Link
            href="/app/dashboard"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              minHeight: "40px",
              padding: "0 16px",
              borderRadius: "8px",
              background: "#122033",
              color: "#ffffff",
              fontSize: "14px",
              fontWeight: 600,
              textDecoration: "none",
            }}
          >
            ダッシュボードへ戻る
          </Link>
        </div>
      </div>
    </main>
  );
}
