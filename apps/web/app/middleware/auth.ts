import { defineNuxtRouteMiddleware, navigateTo, useSupabaseUser } from '#imports';
import { ensureAuthReady, useAuthReady } from '~/composables/useAuthBootstrap';

export default defineNuxtRouteMiddleware(async (to) => {
  const authReady = useAuthReady();
  if (!authReady.value) {
    await ensureAuthReady();
  }

  // If auth isn't known yet (e.g. SSR), do not redirect.
  if (!authReady.value) return;

  const user = useSupabaseUser();

  if (!user.value) {
    return navigateTo(`/login?returnTo=${encodeURIComponent(to.fullPath)}`);
  }
});
