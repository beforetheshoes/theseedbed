"use client";

import { usePathname } from "next/navigation";
import { AppBreadcrumbs } from "@/components/app-breadcrumbs";
import { AppTopBar } from "@/components/app-top-bar";
import { AuthBootstrapLoading } from "@/components/auth-bootstrap-loading";

export default function AuthedLayoutClient({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isLibraryRoute = pathname === "/library";

  return (
    <div className="min-h-screen">
      <AuthBootstrapLoading />
      <AppTopBar />
      <main
        className={`mx-auto w-full min-w-0 px-4 py-6 md:px-8 md:py-8 ${
          isLibraryRoute ? "max-w-none" : "max-w-6xl"
        }`}
      >
        <div className="mb-5 flex items-center justify-between gap-4">
          <AppBreadcrumbs />
        </div>
        {children}
      </main>
    </div>
  );
}
