import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentPropsWithoutRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: ComponentPropsWithoutRef<"a">) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import AppSegmentError from "@/app/(app)/error";
import AppSegmentLoading from "@/app/(app)/loading";
import AppSegmentNotFound from "@/app/(app)/not-found";
import AuthSegmentError from "@/app/(auth)/error";
import AuthSegmentLoading from "@/app/(auth)/loading";
import AuthSegmentNotFound from "@/app/(auth)/not-found";
import PublicSegmentError from "@/app/(public)/error";
import PublicSegmentLoading from "@/app/(public)/loading";
import PublicSegmentNotFound from "@/app/(public)/not-found";

describe("App Router segment boundaries", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("renders loading boundaries for app/auth/public segments", () => {
    const { container } = render(
      <>
        <AppSegmentLoading />
        <AuthSegmentLoading />
        <PublicSegmentLoading />
      </>,
    );

    expect(
      container.querySelector('[data-test="app-segment-loading"]'),
    ).toBeTruthy();
    expect(
      container.querySelector('[data-test="auth-segment-loading"]'),
    ).toBeTruthy();
    expect(
      container.querySelector('[data-test="public-segment-loading"]'),
    ).toBeTruthy();
  });

  it("invokes reset in all segment error boundaries", () => {
    const appReset = vi.fn();
    const authReset = vi.fn();
    const publicReset = vi.fn();

    render(
      <>
        <AppSegmentError error={new Error("app")} reset={appReset} />
        <AuthSegmentError error={new Error("auth")} reset={authReset} />
        <PublicSegmentError error={new Error("public")} reset={publicReset} />
      </>,
    );

    const retryButtons = screen.getAllByRole("button", { name: "Try again" });
    retryButtons.forEach((button) => fireEvent.click(button));

    expect(appReset).toHaveBeenCalledTimes(1);
    expect(authReset).toHaveBeenCalledTimes(1);
    expect(publicReset).toHaveBeenCalledTimes(1);
  });

  it("renders not-found boundaries with recovery links", () => {
    const { container } = render(
      <>
        <AppSegmentNotFound />
        <AuthSegmentNotFound />
        <PublicSegmentNotFound />
      </>,
    );

    expect(
      container.querySelector('[data-test="app-segment-not-found"]'),
    ).toBeTruthy();
    expect(
      container.querySelector('[data-test="auth-segment-not-found"]'),
    ).toBeTruthy();
    expect(
      container.querySelector('[data-test="public-segment-not-found"]'),
    ).toBeTruthy();

    expect(
      screen.getByRole("link", { name: "Back to library" }),
    ).toHaveAttribute("href", "/library");
    expect(screen.getByRole("link", { name: "Back to login" })).toHaveAttribute(
      "href",
      "/login",
    );
    expect(screen.getByRole("link", { name: "Back home" })).toHaveAttribute(
      "href",
      "/",
    );
  });
});
