import type { Metadata } from "next";
import { cookies } from "next/headers";
import "./globals.css";
import { AppReadySignal } from "@/components/app-ready-signal";
import { ColorModeController } from "@/components/color-mode-controller";
import { PrimeProvider } from "@/components/prime-react-provider";
import { ToastProvider } from "@/components/toast-provider";
import { UserThemeBootstrap } from "@/components/user-theme-bootstrap";
import type { ColorMode } from "@/lib/color-mode";

export const metadata: Metadata = {
  title: "The Seedbed",
  description: "Reading companion app",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const cookieMode = cookieStore.get("colorMode")?.value;
  const initialColorMode: ColorMode =
    cookieMode === "light" || cookieMode === "dark" || cookieMode === "system"
      ? cookieMode
      : "system";

  return (
    <html
      lang="en"
      data-app-ready="true"
      data-color-mode={initialColorMode}
      suppressHydrationWarning
    >
      <head>
        {/* eslint-disable-next-line @next/next/no-css-tags -- Runtime theme switching requires a dynamic link tag */}
        <link
          id="primereact-theme"
          rel="stylesheet"
          href="/themes/lara-light-indigo/theme.css"
        />
      </head>
      <body
        data-test="app-shell"
        className="min-h-screen bg-[var(--background)] text-[var(--foreground)]"
      >
        <PrimeProvider>
          <ToastProvider>
            <ColorModeController />
            <UserThemeBootstrap />
            <AppReadySignal />
            {children}
          </ToastProvider>
        </PrimeProvider>
      </body>
    </html>
  );
}
