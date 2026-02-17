import { LoginPageClient } from "@/components/pages/login-page";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolved = await searchParams;
  const returnToRaw = resolved.returnTo;
  const returnTo = typeof returnToRaw === "string" ? returnToRaw : "";

  return <LoginPageClient returnTo={returnTo} />;
}
