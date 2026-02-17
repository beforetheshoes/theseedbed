"use client";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/browser";

const RETURN_TO_STORAGE_KEY = "seedbed.auth.returnTo";
const RETURN_TO_MAX_AGE_MS = 30 * 60 * 1000;

function resolveStoredReturnTo() {
  try {
    const raw = localStorage.getItem(RETURN_TO_STORAGE_KEY);
    if (!raw) return "";
    localStorage.removeItem(RETURN_TO_STORAGE_KEY);
    const parsed = JSON.parse(raw) as { path?: unknown; at?: unknown };
    const path = typeof parsed.path === "string" ? parsed.path : "";
    const at = typeof parsed.at === "number" ? parsed.at : 0;
    if (!path) return "";
    if (at && Date.now() - at > RETURN_TO_MAX_AGE_MS) return "";
    return path;
  } catch {
    return "";
  }
}

export function AuthCallbackPageClient({
  oauthError,
  returnToFromQuery,
}: {
  oauthError: string;
  returnToFromQuery: string;
}) {
  const supabase = createBrowserClient();
  const [message, setMessage] = useState("Validating your session...");
  const [error, setError] = useState("");

  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const run = async () => {
      if (oauthError) {
        setMessage("Sign-in failed.");
        setError(oauthError);
        return;
      }

      const returnTo = returnToFromQuery || resolveStoredReturnTo() || "/library";
      const authCode = new URLSearchParams(window.location.search).get("code");
      let exchangeErrorMessage = "";
      if (authCode) {
        const { error: exchangeError } =
          await supabase.auth.exchangeCodeForSession(authCode);
        if (exchangeError) {
          exchangeErrorMessage = exchangeError.message;
        }
      }

      const { data, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) {
        setError(sessionError.message);
        return;
      }

      if (data.session) {
        window.location.assign(returnTo);
        return;
      }

      setMessage("Waiting for authentication to complete...");
      const { data: authListener } = supabase.auth.onAuthStateChange(
        (_event, session) => {
          if (session) {
            authListener.subscription.unsubscribe();
            window.location.assign(returnTo);
          }
        },
      );

      timeoutId = setTimeout(() => {
        setError(exchangeErrorMessage || "Session not found. Try signing in again.");
        authListener.subscription.unsubscribe();
      }, 6000);
    };

    void run();

    return () => {
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [oauthError, returnToFromQuery, supabase.auth]);

  return (
    <section
      className="rounded-xl border border-slate-300/60 bg-white/80 p-6 text-center shadow-sm"
      data-test="auth-callback-card"
    >
      <h1 className="text-2xl font-semibold tracking-tight">
        Finishing sign-in
      </h1>
      <p className="mt-2 text-sm text-slate-600">{message}</p>
      {error ? (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}
    </section>
  );
}
