<template>
  <Card class="text-center" data-test="auth-callback-card">
    <template #content>
      <div class="flex flex-col items-center gap-4 py-6">
        <i class="pi pi-spinner pi-spin text-3xl text-primary" aria-hidden="true"></i>
        <h1 class="font-serif text-2xl font-semibold tracking-tight">Finishing sign-in</h1>
        <p class="text-sm text-[var(--p-text-muted-color)]">
          {{ message }}
        </p>
        <Message v-if="error" severity="error" :closable="false">{{ error }}</Message>
      </div>
    </template>
  </Card>
</template>

<script setup lang="ts">
definePageMeta({ layout: 'auth' });

import { onMounted, ref } from 'vue';
import { navigateTo, useRoute, useSupabaseClient } from '#imports';

const supabase = useSupabaseClient();
const route = useRoute();

const message = ref('Validating your session…');
const error = ref('');

const RETURN_TO_STORAGE_KEY = 'seedbed.auth.returnTo';
const RETURN_TO_MAX_AGE_MS = 30 * 60 * 1000;

const resolveStoredReturnTo = () => {
  const storage = globalThis.localStorage;
  if (
    !storage ||
    typeof storage.getItem !== 'function' ||
    typeof storage.removeItem !== 'function'
  ) {
    return '';
  }

  try {
    const raw = storage.getItem(RETURN_TO_STORAGE_KEY);
    if (!raw) {
      return '';
    }

    storage.removeItem(RETURN_TO_STORAGE_KEY);

    const parsed = JSON.parse(raw) as { path?: unknown; at?: unknown };
    const path = typeof parsed.path === 'string' ? parsed.path : '';
    const at = typeof parsed.at === 'number' ? parsed.at : 0;

    if (!path) {
      return '';
    }

    if (at && Date.now() - at > RETURN_TO_MAX_AGE_MS) {
      return '';
    }

    return path;
  } catch {
    return '';
  }
};

const resolveReturnTo = () => {
  const queryReturnTo =
    typeof route.query.returnTo === 'string' && route.query.returnTo ? route.query.returnTo : '';
  if (queryReturnTo) {
    return queryReturnTo;
  }

  const storedReturnTo = resolveStoredReturnTo();
  if (storedReturnTo) {
    return storedReturnTo;
  }

  return '/';
};

const resolveOAuthError = () => {
  const code = typeof route.query.error === 'string' ? route.query.error : '';
  const description =
    typeof route.query.error_description === 'string' ? route.query.error_description : '';

  if (description) {
    return description;
  }

  if (code) {
    return `Authentication failed (${code}).`;
  }

  return '';
};

onMounted(async () => {
  if (!supabase) {
    error.value = 'Supabase client is not available.';
    return;
  }

  const oauthError = resolveOAuthError();
  if (oauthError) {
    message.value = 'Sign-in failed.';
    error.value = oauthError;
    return;
  }

  const returnTo = resolveReturnTo();

  const { data, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) {
    error.value = sessionError.message;
    return;
  }

  if (data.session) {
    await navigateTo(returnTo);
    return;
  }

  message.value = 'Waiting for authentication to complete…';

  const { data: authListener } = supabase.auth.onAuthStateChange(async (_event, session) => {
    if (session) {
      authListener.subscription.unsubscribe();
      await navigateTo(returnTo);
    }
  });

  globalThis.setTimeout(() => {
    if (!error.value) {
      error.value = 'Session not found. Try signing in again.';
      authListener.subscription.unsubscribe();
    }
  }, 6000);
});
</script>
