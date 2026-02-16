import { defineNuxtPlugin, useSupabaseUser } from '#imports';
import { ensureAuthReady } from '~/composables/useAuthBootstrap';
import { applyUserTheme, type UserThemeSettings } from '~/composables/useUserTheme';
import { apiRequest } from '~/utils/api';

export default defineNuxtPlugin(async () => {
  try {
    await ensureAuthReady();
    const user = useSupabaseUser();
    if (!user.value) return;

    const profile = await apiRequest<UserThemeSettings>('/api/v1/me');
    applyUserTheme(profile);
  } catch {
    // Keep default theme when bootstrap/me request fails.
  }
});
