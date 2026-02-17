"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "primereact/button";
import { Card } from "primereact/card";
import { Message } from "primereact/message";
import { createBrowserClient } from "@/lib/supabase/browser";

type AuthorizationDetails = {
  authorization_id: string;
  redirect_uri: string;
  scope: string;
  client: {
    id: string;
    name: string | null;
    uri: string | null;
    logo_uri: string | null;
  };
};

export function OauthConsentPageClient({
  authorizationId,
  returnTo,
}: {
  authorizationId: string;
  returnTo: string;
}) {
  const router = useRouter();
  const supabase = createBrowserClient();
  const [authorization, setAuthorization] =
    useState<AuthorizationDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const scopes = useMemo(
    () =>
      authorization?.scope
        ? authorization.scope
            .split(" ")
            .map((item) => item.trim())
            .filter(Boolean)
        : [],
    [authorization],
  );

  useEffect(() => {
    const run = async () => {
      if (!authorizationId) {
        setError("Missing authorization request.");
        setLoading(false);
        return;
      }

      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) {
        router.replace(`/login?returnTo=${encodeURIComponent(returnTo)}`);
        return;
      }

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        router.replace(`/login?returnTo=${encodeURIComponent(returnTo)}`);
        return;
      }

      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (!supabaseUrl || !supabaseAnonKey) {
        setError("Supabase configuration is missing.");
        setLoading(false);
        return;
      }

      const response = await fetch(
        `${supabaseUrl}/auth/v1/oauth/authorizations/${authorizationId}`,
        {
          headers: {
            apikey: supabaseAnonKey,
            Authorization: `Bearer ${session.access_token}`,
          },
        },
      );

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        setError(payload?.message ?? "Unable to load authorization details.");
        setLoading(false);
        return;
      }

      setAuthorization((await response.json()) as AuthorizationDetails);
      setLoading(false);
    };

    void run();
  }, [authorizationId, returnTo, router, supabase.auth]);

  const submitConsent = async (action: "approve" | "deny") => {
    if (!authorizationId) return;

    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.access_token) {
      router.replace(`/login?returnTo=${encodeURIComponent(returnTo)}`);
      return;
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseAnonKey) {
      setError("Supabase configuration is missing.");
      return;
    }

    setSubmitting(true);
    setError("");

    const response = await fetch(
      `${supabaseUrl}/auth/v1/oauth/authorizations/${authorizationId}/consent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: supabaseAnonKey,
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ action }),
      },
    );

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      setError(payload?.message ?? "Unable to submit consent.");
      setSubmitting(false);
      return;
    }

    const payload = (await response.json()) as { redirect_url: string };
    window.location.assign(payload.redirect_url);
  };

  return (
    <Card className="rounded-xl shadow-sm" data-test="oauth-consent-card">
      <h1 className="text-2xl font-semibold tracking-tight">
        Authorize access
      </h1>
      {loading ? (
        <p className="mt-2 text-sm text-[var(--p-text-muted-color)]">
          Loading authorization details...
        </p>
      ) : null}
      {error ? (
        <Message className="mt-2" severity="error" text={error} />
      ) : null}
      {!loading && !error && authorization ? (
        <div className="mt-4 space-y-3">
          <p className="text-sm font-semibold">
            {authorization.client.name ?? "Unnamed application"}
          </p>
          <p className="text-sm text-[var(--p-text-muted-color)]">
            {authorization.client.uri ?? "No client URL provided"}
          </p>
          <ul className="list-disc space-y-1 pl-6 text-sm text-[var(--p-text-muted-color)]">
            {scopes.map((scope) => (
              <li key={scope}>{scope}</li>
            ))}
          </ul>
          <div className="flex gap-2">
            <Button
              disabled={submitting}
              loading={submitting}
              data-test="oauth-approve"
              onClick={() => void submitConsent("approve")}
            >
              Approve
            </Button>
            <Button
              outlined
              severity="secondary"
              disabled={submitting}
              data-test="oauth-deny"
              onClick={() => void submitConsent("deny")}
            >
              Deny
            </Button>
          </div>
        </div>
      ) : null}
    </Card>
  );
}
