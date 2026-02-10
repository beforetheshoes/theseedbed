import { defineNuxtRouteMiddleware, navigateTo, useSupabaseUser } from '#imports';

export default defineNuxtRouteMiddleware((to) => {
  const user = useSupabaseUser();

  if (!user.value) {
    return navigateTo(`/login?returnTo=${encodeURIComponent(to.fullPath)}`);
  }
});
