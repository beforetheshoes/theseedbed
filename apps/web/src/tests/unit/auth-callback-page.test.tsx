import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/browser", () => ({
  createBrowserClient: vi.fn(() => ({
    auth: {
      exchangeCodeForSession: vi.fn(),
      getSession: vi.fn(),
      onAuthStateChange: vi.fn(() => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      })),
    },
  })),
}));

import { AuthCallbackPageClient } from "@/components/pages/auth-callback-page";

describe("Auth callback page dark-mode surfaces", () => {
  it("uses tokenized classes for card, message, and error state", async () => {
    const { container } = render(
      <AuthCallbackPageClient oauthError="OAuth failed" returnToFromQuery="" />,
    );

    await waitFor(() => {
      expect(screen.getByText("Sign-in failed.")).toBeInTheDocument();
      expect(screen.getByText("OAuth failed")).toBeInTheDocument();
    });

    const card = container.querySelector('[data-test="auth-callback-card"]');
    const message = screen.getByText("Sign-in failed.");
    const error = screen.getByText("OAuth failed");

    expect(card).toHaveClass("border-[var(--p-content-border-color)]");
    expect(card).toHaveClass("bg-[var(--surface-card)]");
    expect(message).toHaveClass("text-[var(--p-text-muted-color)]");
    expect(error).toHaveClass("bg-[var(--p-red-50)]");
    expect(error).toHaveClass("text-[var(--p-red-700)]");

    expect(container.innerHTML).not.toContain("bg-white");
    expect(container.innerHTML).not.toContain("border-slate");
    expect(container.innerHTML).not.toContain("text-slate");
  });
});
