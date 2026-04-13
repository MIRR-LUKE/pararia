import type { NextPageContext } from "next";

type Props = {
  statusCode?: number;
};

function ErrorPage({ statusCode }: Props) {
  const title = statusCode === 404 ? "ページが見つかりません" : "エラーが発生しました";
  const message =
    statusCode === 404
      ? "URL が変わったか、削除された可能性があります。"
      : "時間をおいてから、もう一度お試しください。";

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
        <p style={{ margin: 0, fontSize: "12px", fontWeight: 700 }}>{statusCode ?? 500}</p>
        <h1 style={{ margin: 0, fontSize: "28px", lineHeight: 1.2 }}>{title}</h1>
        <p style={{ margin: 0, fontSize: "14px", lineHeight: 1.7, color: "#4e6179" }}>{message}</p>
      </div>
    </main>
  );
}

ErrorPage.getInitialProps = ({ res, err }: NextPageContext) => {
  const statusCode = res?.statusCode ?? err?.statusCode ?? 500;
  return { statusCode };
};

export default ErrorPage;
