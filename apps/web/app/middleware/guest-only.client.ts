import { defineNuxtRouteMiddleware, navigateTo, useSupabaseUser } from '#imports';
import { ensureAuthReady } from '~/composables/useAuthBootstrap';

export default defineNuxtRouteMiddleware(async () => {
  await ensureAuthReady();
  const user = useSupabaseUser();
  if (user.value) {
    return navigateTo('/library');
  }
});
