"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "primereact/button";
import { Menu } from "primereact/menu";
import type { MenuItem } from "primereact/menuitem";
import { Menubar } from "primereact/menubar";
import { Sidebar } from "primereact/sidebar";
import { createBrowserClient } from "@/lib/supabase/browser";
import { appNavItems } from "@/lib/navigation";
import { useColorMode } from "@/hooks/use-color-mode";
import { AppTopBarBookSearch } from "@/components/app-topbar-book-search";

export function AppTopBar() {
  const pathname = usePathname();
  const router = useRouter();
  const { mode, setMode } = useColorMode();
  const supabase = useMemo(() => createBrowserClient(), []);

  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const accountMenuRef = useRef<Menu>(null);
  const colorMenuRef = useRef<Menu>(null);

  useEffect(() => {
    let active = true;
    const loadUser = async () => {
      const { data } = await supabase.auth.getUser();
      if (!active) return;
      setUserEmail(data.user?.email ?? null);
    };
    void loadUser();
    return () => {
      active = false;
    };
  }, [supabase]);

  const signOut = async () => {
    await supabase.auth.signOut();
    setUserEmail(null);
    router.push("/login");
  };

  const colorItems: MenuItem[] = [
    {
      template: () => (
        <Button
          text
          severity="secondary"
          className="p-menuitem-link w-full"
          data-test="color-mode-system"
          onClick={() => setMode("system")}
        >
          <span className="p-menuitem-icon pi pi-desktop" />
          <span className="p-menuitem-text">System</span>
        </Button>
      ),
    },
    {
      template: () => (
        <Button
          text
          severity="secondary"
          className="p-menuitem-link w-full"
          data-test="color-mode-light"
          onClick={() => setMode("light")}
        >
          <span className="p-menuitem-icon pi pi-sun" />
          <span className="p-menuitem-text">Light</span>
        </Button>
      ),
    },
    {
      template: () => (
        <Button
          text
          severity="secondary"
          className="p-menuitem-link w-full"
          data-test="color-mode-dark"
          onClick={() => setMode("dark")}
        >
          <span className="p-menuitem-icon pi pi-moon" />
          <span className="p-menuitem-text">Dark</span>
        </Button>
      ),
    },
  ];

  const accountItems: MenuItem[] = userEmail
    ? [
        { label: userEmail, icon: "pi pi-envelope", disabled: true },
        { separator: true },
        {
          label: "Settings",
          icon: "pi pi-cog",
          command: () => router.push("/settings"),
        },
        {
          label: "Sign out",
          icon: "pi pi-sign-out",
          command: () => void signOut(),
        },
      ]
    : [
        {
          label: "Sign in",
          icon: "pi pi-sign-in",
          command: () => router.push("/login"),
        },
      ];

  return (
    <div className="sticky top-0 z-40">
      <Menubar
        model={[]}
        className="relative rounded-none border-x-0 border-t-0 px-3 md:px-5"
        start={
          <div className="flex items-center gap-2">
            <Button
              className="md:!hidden"
              icon="pi pi-bars"
              text
              severity="secondary"
              aria-label="Open navigation"
              data-test="app-nav-open"
              onClick={() => setMobileNavOpen(true)}
            />

            <Button
              text
              severity="secondary"
              data-test="topbar-home"
              aria-label="Home"
              onClick={() => router.push("/")}
            >
              <span className="pi pi-book mr-2 text-[var(--p-primary-color)]" />
              <span className="text-lg font-semibold tracking-tight">
                The Seedbed
              </span>
            </Button>
          </div>
        }
        end={
          <div className="flex items-center gap-1 md:gap-2">
            {userEmail ? <AppTopBarBookSearch /> : null}

            <div className="hidden items-center gap-1 sm:flex" aria-label="Color mode">
              <Button
                icon="pi pi-desktop"
                outlined={mode === "system"}
                text={mode !== "system"}
                severity="secondary"
                size="small"
                aria-label="System theme"
                data-test="color-mode-system"
                onClick={() => setMode("system")}
              />
              <Button
                icon="pi pi-sun"
                outlined={mode === "light"}
                text={mode !== "light"}
                severity="secondary"
                size="small"
                aria-label="Light theme"
                data-test="color-mode-light"
                onClick={() => setMode("light")}
              />
              <Button
                icon="pi pi-moon"
                outlined={mode === "dark"}
                text={mode !== "dark"}
                severity="secondary"
                size="small"
                aria-label="Dark theme"
                data-test="color-mode-dark"
                onClick={() => setMode("dark")}
              />
            </div>

            <Button
              className="sm:!hidden"
              icon="pi pi-palette"
              text
              severity="secondary"
              size="small"
              aria-label="Theme menu"
              data-test="color-mode-menu"
              onClick={(event) => colorMenuRef.current?.toggle(event)}
            />
            <Menu model={colorItems} popup ref={colorMenuRef} />

            {userEmail ? (
              <Button
                icon="pi pi-user"
                text
                severity="secondary"
                aria-label="Account"
                data-test="account-open"
                onClick={(event) => accountMenuRef.current?.toggle(event)}
              />
            ) : (
              <Button text data-test="account-signin" onClick={() => router.push("/login")}>
                Sign in
              </Button>
            )}
            <Menu model={accountItems} popup ref={accountMenuRef} />
          </div>
        }
      />

      <Sidebar
        visible={mobileNavOpen}
        position="left"
        onHide={() => setMobileNavOpen(false)}
        showCloseIcon
        className="w-[18rem]"
      >
        <nav className="mt-2 flex flex-col gap-1">
          {appNavItems.map((item) => (
            <Link
              key={item.to}
              href={item.to}
              className={`rounded px-3 py-2 text-sm ${pathname === item.to ? "font-semibold" : ""}`}
              data-test={item.to === "/" ? "drawer-home" : undefined}
              onClick={() => setMobileNavOpen(false)}
            >
              {item.label}
            </Link>
          ))}
          <Link
            href="/login"
            className="rounded px-3 py-2 text-sm"
            data-test="account-signin"
            onClick={() => setMobileNavOpen(false)}
          >
            Sign in
          </Link>
        </nav>
      </Sidebar>
    </div>
  );
}
