"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "primereact/button";
import { Card } from "primereact/card";
import { InputText } from "primereact/inputtext";
import { Message } from "primereact/message";
import { createBrowserClient } from "@/lib/supabase/browser";

const RETURN_TO_STORAGE_KEY = "seedbed.auth.returnTo";

function persistReturnTo(path: string) {
  if (!path) return;
  try {
    localStorage.setItem(
      RETURN_TO_STORAGE_KEY,
      JSON.stringify({ path, at: Date.now() }),
    );
  } catch {
    // no-op
  }
}

function buildRedirectTo() {
  if (!window.location.origin) return "";
  return `${window.location.origin}/auth/callback`;
}

export function LoginPageClient({ returnTo }: { returnTo: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  const supabase = createBrowserClient();

  useEffect(() => {
    let cancelled = false;

    const hydrateSession = async () => {
      const { data } = await supabase.auth.getSession();
      if (!cancelled && data.session) {
        router.replace(returnTo || "/library");
      }
    };

    void hydrateSession();

    return () => {
      cancelled = true;
    };
  }, [returnTo, router, supabase.auth]);

  const signInWithProvider = async (provider: "google" | "apple") => {
    setStatus("");
    setError("");
    setBusy(true);
    persistReturnTo(returnTo);

    const { error: signInError } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: buildRedirectTo(),
      },
    });

    setBusy(false);
    if (signInError) setError(signInError.message);
  };

  const sendMagicLink = async () => {
    setStatus("");
    setError("");
    if (!email.trim()) {
      setError("Enter a valid email address.");
      return;
    }

    setBusy(true);
    persistReturnTo(returnTo);

    const { error: signInError } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        emailRedirectTo: buildRedirectTo(),
      },
    });

    setBusy(false);

    if (signInError) {
      setError(signInError.message);
      return;
    }

    setStatus("Check your inbox for the magic link.");
  };

  const oauthButtonClassName =
    "h-14 w-full justify-center rounded-lg border border-[#d1d5db] bg-white px-4 text-[1.08rem] font-semibold text-[#1f1f1f] shadow-none hover:bg-white";
  const oauthButtonStyle = {
    backgroundColor: "var(--oauth-button-bg)",
    color: "var(--oauth-button-fg)",
    border: "1px solid var(--oauth-button-border)",
  };

  return (
    <Card className="rounded-xl shadow-sm" data-test="login-card">
      <h1 className="text-center font-heading text-2xl font-semibold tracking-tight">
        Welcome to The Seedbed
      </h1>
      <p className="mt-1 text-center text-sm font-medium text-[var(--p-text-muted-color)]">
        Please sign in.
      </p>

      <div className="mt-5 flex flex-col gap-3">
        <Button
          className={oauthButtonClassName}
          style={oauthButtonStyle}
          data-test="login-apple"
          disabled={busy}
          onClick={() => void signInWithProvider("apple")}
        >
          <span className="mr-3 inline-flex h-5 w-5 items-center justify-center">
            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
              focusable="false"
              className="h-5 w-5 fill-current"
            >
              <path d="M16.365 12.19c.03 3.1 2.73 4.13 2.76 4.14-.02.07-.43 1.47-1.42 2.92-.86 1.25-1.75 2.5-3.16 2.53-1.39.03-1.84-.82-3.43-.82-1.6 0-2.1.79-3.4.84-1.36.05-2.4-1.36-3.27-2.6-1.78-2.57-3.15-7.25-1.31-10.43.91-1.58 2.55-2.57 4.34-2.6 1.35-.03 2.62.9 3.43.9.8 0 2.31-1.12 3.9-.96.67.03 2.55.27 3.76 2.05-.1.07-2.24 1.31-2.22 3.9Zm-2.13-6.74c.72-.87 1.2-2.08 1.07-3.29-1.03.04-2.26.69-3 1.56-.66.76-1.24 1.98-1.09 3.14 1.14.09 2.3-.58 3.02-1.41Z" />
            </svg>
          </span>
          <span>Sign in with Apple</span>
        </Button>
        <Button
          className={oauthButtonClassName}
          style={oauthButtonStyle}
          data-test="login-google"
          disabled={busy}
          onClick={() => void signInWithProvider("google")}
        >
          <span className="mr-3 inline-flex h-5 w-5 items-center justify-center">
            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
              focusable="false"
              className="h-5 w-5"
            >
              <path
                fill="#EA4335"
                d="M12 10.2v3.9h5.4c-.23 1.25-.94 2.3-2.02 3l3.27 2.54c1.9-1.75 3-4.33 3-7.39 0-.7-.06-1.38-.18-2.03H12Z"
              />
              <path
                fill="#34A853"
                d="M12 21.8c2.7 0 4.97-.9 6.62-2.43l-3.27-2.54c-.9.6-2.05.97-3.35.97-2.58 0-4.77-1.74-5.56-4.08H3.06v2.62A10 10 0 0 0 12 21.8Z"
              />
              <path
                fill="#4A90E2"
                d="M6.44 13.72A6 6 0 0 1 6.13 12c0-.6.1-1.18.3-1.72V7.66H3.05A10 10 0 0 0 2 12c0 1.6.38 3.1 1.05 4.34l3.39-2.62Z"
              />
              <path
                fill="#FBBC05"
                d="M12 6.2c1.47 0 2.78.5 3.82 1.5l2.86-2.86C16.96 3.24 14.7 2.2 12 2.2a10 10 0 0 0-8.95 5.46l3.38 2.62C7.22 7.94 9.4 6.2 12 6.2Z"
              />
            </svg>
          </span>
          <span>Sign in with Google</span>
        </Button>
      </div>

      <div className="my-5 flex items-center gap-3 text-sm text-[var(--p-text-muted-color)]">
        <span className="h-px flex-1 bg-[var(--p-content-border-color)]" />
        <span className="uppercase tracking-wide">or</span>
        <span className="h-px flex-1 bg-[var(--p-content-border-color)]" />
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="email" className="text-sm font-medium">
          Email
        </label>
        <InputText
          id="email"
          data-test="login-email"
          type="email"
          placeholder="you@theseedbed.app"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </div>

      <div className="pt-4">
        <Button
          className="w-full justify-center"
          data-test="login-magic-link"
          loading={busy}
          disabled={busy}
          onClick={() => void sendMagicLink()}
        >
          Send magic link
        </Button>
      </div>

      {status ? (
        <Message className="mt-3" severity="info" text={status} />
      ) : null}
      {error ? (
        <Message
          className="mt-3"
          severity="error"
          data-test="login-error"
          text={error}
        />
      ) : null}
    </Card>
  );
}
