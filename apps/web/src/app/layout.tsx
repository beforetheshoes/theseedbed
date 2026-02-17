import type { Metadata } from "next";
import "./globals.css";
import { AppReadySignal } from "@/components/app-ready-signal";
import { ColorModeController } from "@/components/color-mode-controller";
import { PrimeProvider } from "@/components/prime-react-provider";
import { ToastProvider } from "@/components/toast-provider";
import { UserThemeBootstrap } from "@/components/user-theme-bootstrap";

export const metadata: Metadata = {
  title: "The Seedbed",
  description: "Reading companion app",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" data-app-ready="true">
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
