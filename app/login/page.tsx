import { Suspense } from "react";
import { LoginForm } from "./LoginForm";

export default async function LoginPage({
  searchParams,
}: {
  searchParams?: Promise<{ callbackUrl?: string }>;
}) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const callbackUrl = resolvedSearchParams.callbackUrl || "/app/dashboard";

  return (
    <Suspense>
      <LoginForm callbackUrl={callbackUrl} />
    </Suspense>
  );
}
