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

  return (
    <Card className="rounded-xl shadow-sm" data-test="login-card">
      <h1 className="font-heading text-2xl font-semibold tracking-tight">
        Welcome back
      </h1>
      <p className="mt-1 text-sm text-[var(--p-text-muted-color)]">
        Sign in to The Seedbed
      </p>

      <div className="mt-5 flex flex-col gap-3">
        <Button
          outlined
          severity="secondary"
          className="justify-start"
          data-test="login-apple"
          disabled={busy}
          onClick={() => void signInWithProvider("apple")}
        >
          Continue with Apple
        </Button>
        <Button
          outlined
          severity="secondary"
          className="justify-start"
          data-test="login-google"
          disabled={busy}
          onClick={() => void signInWithProvider("google")}
        >
          Continue with Google
        </Button>
      </div>

      <div className="mt-5 flex flex-col gap-2">
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

      <Button
        className="mt-4 w-full"
        data-test="login-magic-link"
        loading={busy}
        disabled={busy}
        onClick={() => void sendMagicLink()}
      >
        Send magic link
      </Button>

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
