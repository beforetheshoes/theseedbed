import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: vi.fn(),
  }),
}));

vi.mock("@/lib/supabase/browser", () => ({
  createBrowserClient: () => ({
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      signInWithOAuth: vi.fn(),
      signInWithOtp: vi.fn(),
    },
  }),
}));

import { LoginPageClient } from "@/components/pages/login-page";

describe("Login page", () => {
  it("renders oauth buttons with provider icons", () => {
    const { container } = render(<LoginPageClient returnTo="/library" />);

    const appleButton = container.querySelector('[data-test="login-apple"]');
    const googleButton = container.querySelector('[data-test="login-google"]');

    expect(appleButton).not.toBeNull();
    expect(googleButton).not.toBeNull();
    expect(screen.getByText("Sign in with Apple")).toBeInTheDocument();
    expect(screen.getByText("Sign in with Google")).toBeInTheDocument();
    expect(appleButton?.querySelector("svg")).not.toBeNull();
    expect(googleButton?.querySelector("svg")).not.toBeNull();
  });
});
