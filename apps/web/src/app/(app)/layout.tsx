"use client";

import { AppTopBar } from "@/components/app-top-bar";
import { AppBreadcrumbs } from "@/components/app-breadcrumbs";
import { AuthBootstrapLoading } from "@/components/auth-bootstrap-loading";
import { usePathname } from "next/navigation";

export default function AuthedLayout({
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
