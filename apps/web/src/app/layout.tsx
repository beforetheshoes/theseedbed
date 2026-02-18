import type { Metadata } from "next";
import { cookies } from "next/headers";
import Script from "next/script";
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
      data-app-ready="false"
      data-color-mode={initialColorMode}
      suppressHydrationWarning
    >
      <head>
        <link
          rel="preload"
          as="style"
          href="/themes/lara-light-indigo/theme.css"
        />
        {/* eslint-disable-next-line @next/next/no-css-tags -- Runtime theme switching requires a dynamic link tag */}
        <link
          id="primereact-theme"
          rel="stylesheet"
          href="/themes/lara-light-indigo/theme.css"
        />
        <style>{`
html[data-app-ready="false"] #boot-splash {
  display: grid;
}
html[data-app-ready="true"] #boot-splash {
  display: none;
}
html[data-app-ready="false"] #app-shell-content {
  visibility: hidden;
}
html[data-app-ready="true"] #app-shell-content {
  visibility: visible;
}
#boot-splash {
  background: #f7f5f0;
  color: #1e232f;
}
html[data-color-mode="dark"] #boot-splash {
  background: #0b121d;
  color: #eef4ff;
}
@media (prefers-color-scheme: dark) {
  html[data-color-mode="system"] #boot-splash {
    background: #0b121d;
    color: #eef4ff;
  }
}
`}</style>
        <Script
          id="boot-splash-fallback"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{
            __html: `
(() => {
  const root = document.documentElement;
  const reveal = () => {
    if (root.dataset.appReady !== "true") {
      root.dataset.appReady = "true";
    }
  };

  window.addEventListener("load", reveal, { once: true });
  window.setTimeout(reveal, 8000);
})();
            `,
          }}
        />
      </head>
      <body
        data-test="app-shell"
        className="min-h-screen bg-[var(--background)] text-[var(--foreground)]"
      >
        <div
          id="boot-splash"
          style={{
            position: "fixed",
            inset: "0",
            zIndex: "9999",
            display: "none",
            placeItems: "center",
            fontFamily:
              "var(--app-font-family, ui-sans-serif, system-ui, sans-serif)",
            fontSize: "0.95rem",
            letterSpacing: "0.01em",
          }}
        >
          Loading interface...
        </div>
        <div id="app-shell-content" data-test="app-shell-content">
          <PrimeProvider>
            <ToastProvider>
              <ColorModeController />
              <UserThemeBootstrap />
              <AppReadySignal />
              {children}
            </ToastProvider>
          </PrimeProvider>
        </div>
      </body>
    </html>
  );
}
