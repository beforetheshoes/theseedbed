"use client";

import { useEffect, useMemo, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/browser";

export function AuthBootstrapLoading() {
  const supabase = useMemo(() => createBrowserClient(), []);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const bootstrap = async () => {
      try {
        await supabase.auth.getSession();
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };
    void bootstrap();
    return () => {
      active = false;
    };
  }, [supabase]);

  if (!loading) return null;
  return (
    <div
      className="sr-only"
      aria-hidden="true"
      data-test="auth-bootstrap-loading"
    />
  );
}
