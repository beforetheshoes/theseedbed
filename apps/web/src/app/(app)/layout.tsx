import AuthedLayoutClient from "@/components/layout/authed-layout-client";

export default function AuthedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AuthedLayoutClient>{children}</AuthedLayoutClient>;
}
