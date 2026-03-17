import { Suspense } from "react";
import { LoginForm } from "./LoginForm";

export default function LoginPage({
  searchParams,
}: {
  searchParams?: { callbackUrl?: string };
}) {
  const callbackUrl = searchParams?.callbackUrl || "/app/dashboard";

  return (
    <Suspense>
      <LoginForm callbackUrl={callbackUrl} />
    </Suspense>
  );
}