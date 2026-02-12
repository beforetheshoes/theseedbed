import { useState, useSupabaseClient, useSupabaseUser } from '#imports';
import type { User } from '@supabase/supabase-js';

const AUTH_READY_STATE_KEY = 'auth:ready';
const DEFAULT_BOOTSTRAP_TIMEOUT_MS = 3000;

let bootstrapPromise: Promise<void> | null = null;

export function useAuthReady() {
  return useState<boolean>(AUTH_READY_STATE_KEY, () => false);
}

/**
 * Waits until the initial Supabase auth state is known on the client.
 *
 * This prevents route middleware from treating a signed-in user as signed-out
 * during the brief window where Supabase restores the session from storage.
 */
export async function ensureAuthReady(options?: { timeoutMs?: number }): Promise<void> {
  if (typeof window === 'undefined') return;

  const authReady = useAuthReady();
  if (authReady.value) return;

  if (bootstrapPromise) {
    await bootstrapPromise;
    return;
  }

  const timeoutMs = options?.timeoutMs ?? DEFAULT_BOOTSTRAP_TIMEOUT_MS;

  bootstrapPromise = new Promise<void>((resolve) => {
    const supabase = useSupabaseClient();
    const user = useSupabaseUser();

    let settled = false;
    let subscription: { unsubscribe: () => void } | null = null;

    const timeoutId: ReturnType<typeof setTimeout> = globalThis.setTimeout(() => {
      // Avoid navigation deadlocks if INITIAL_SESSION doesn't arrive for some reason.
      try {
        subscription?.unsubscribe();
      } catch {
        // ignore
      }
      settle(undefined);
    }, timeoutMs);

    const settle = (nextUser: User | null | undefined) => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timeoutId);

      if (nextUser !== undefined) {
        user.value = nextUser ?? null;
      }

      authReady.value = true;
      resolve();
    };

    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'INITIAL_SESSION') {
        try {
          subscription?.unsubscribe();
        } catch {
          // ignore
        }
        settle(session?.user ?? null);
      }
    });
    subscription = data.subscription;
  });

  await bootstrapPromise;
}
