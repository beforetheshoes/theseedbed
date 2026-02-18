"use client";

import { useLayoutEffect, useMemo } from "react";
import { apiRequest } from "@/lib/api";
import { createBrowserClient } from "@/lib/supabase/browser";
import {
  applyUserTheme,
  readStoredUserTheme,
  type UserThemeSettings,
} from "@/lib/user-theme";

export function UserThemeBootstrap() {
  const supabase = useMemo(() => createBrowserClient(), []);

  useLayoutEffect(() => {
    let active = true;
    const cachedTheme = readStoredUserTheme();
    if (cachedTheme) {
      applyUserTheme(cachedTheme);
    }

    const bootstrapTheme = async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session) return;

        const profile = await apiRequest<UserThemeSettings>(
          supabase,
          "/api/v1/me",
        );
        if (!active) return;
        applyUserTheme(profile);
      } catch {
        // Keep defaults if theme bootstrap fails.
      }
    };

    void bootstrapTheme();
    return () => {
      active = false;
    };
  }, [supabase]);

  return null;
}
