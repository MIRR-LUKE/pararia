import { Suspense } from "react";
import { InviteAcceptForm } from "./InviteAcceptForm";

function AcceptInner({ searchParams }: { searchParams: { token?: string } }) {
  const token = typeof searchParams.token === "string" ? searchParams.token : "";
  if (!token) {
    return (
      <div style={{ padding: "2rem", textAlign: "center" }}>
        <p>招待リンクが不正です。token パラメータがありません。</p>
      </div>
    );
  }
  return <InviteAcceptForm token={token} />;
}

export default function InviteAcceptPage({
  searchParams,
}: {
  searchParams: { token?: string };
}) {
  return (
    <Suspense>
      <AcceptInner searchParams={searchParams} />
    </Suspense>
  );
}
