<template>
  <Card data-test="login-card">
    <template #title>
      <div class="flex flex-col items-center gap-2 text-center">
        <Avatar icon="pi pi-book" shape="circle" size="xlarge" :pt="avatarPt" />
        <h1 class="text-2xl font-semibold tracking-tight">Welcome back</h1>
        <p class="text-sm text-[var(--p-text-muted-color)]">Sign in to The Seedbed</p>
      </div>
    </template>
    <template #content>
      <div class="flex flex-col gap-5">
        <Button
          class="w-full"
          icon="pi pi-apple"
          label="Continue with Apple"
          :loading="busy"
          severity="secondary"
          variant="outlined"
          size="large"
          data-test="login-apple"
          @click="signInWithApple"
        />
        <Button
          class="w-full"
          icon="pi pi-google"
          label="Continue with Google"
          :loading="busy"
          severity="secondary"
          variant="outlined"
          size="large"
          data-test="login-google"
          @click="signInWithGoogle"
        />
        <Divider align="center">
          <span class="text-xs uppercase tracking-[0.22em] text-[var(--p-text-muted-color)]"
            >or</span
          >
        </Divider>
        <div class="flex flex-col gap-2">
          <label class="text-sm font-medium" for="email">Email</label>
          <InputText
            id="email"
            v-model="email"
            :class="['w-full', { 'p-invalid': !!error }]"
            type="email"
            placeholder="you@theseedbed.app"
            autocomplete="email"
            size="large"
            data-test="login-email"
          />
        </div>
        <Button
          class="w-full"
          label="Send magic link"
          :loading="busy"
          severity="primary"
          raised
          size="large"
          data-test="login-magic-link"
          @click="sendMagicLink"
        />
        <Message v-if="status" severity="info" :closable="false">{{ status }}</Message>
        <Message v-if="error" severity="error" :closable="false" data-test="login-error">{{
          error
        }}</Message>
        <Message v-if="!supabase" severity="error" :closable="false"
          >Supabase client is not configured. Check environment variables.</Message
        >
      </div>
    </template>
  </Card>
</template>

<script setup lang="ts">
definePageMeta({ layout: 'auth', middleware: ['guest-only-client'] });

import { computed, ref } from 'vue';
import { useRoute, useSupabaseClient } from '#imports';
import Avatar from 'primevue/avatar';

const supabase = useSupabaseClient();
const route = useRoute();

const email = ref('');
const busy = ref(false);
const status = ref('');
const error = ref('');

const returnTo = computed(() =>
  typeof route.query.returnTo === 'string' ? route.query.returnTo : '',
);

const avatarPt = {
  root: { class: 'bg-[var(--p-primary-100)] text-primary' },
};

const RETURN_TO_STORAGE_KEY = 'seedbed.auth.returnTo';

const persistReturnTo = () => {
  if (!returnTo.value) {
    return;
  }

  const storage = globalThis.localStorage;
  if (!storage || typeof storage.setItem !== 'function') {
    return;
  }

  try {
    storage.setItem(
      RETURN_TO_STORAGE_KEY,
      JSON.stringify({ path: returnTo.value, at: Date.now() }),
    );
  } catch {
    // Best-effort only; auth flow still works without restoring returnTo.
  }
};

const buildRedirectTo = () => {
  if (!globalThis.location) {
    return '';
  }

  const origin = globalThis.location.origin;
  if (!origin) {
    return '';
  }

  // Keep this redirect URL stable and allow-list friendly.
  // We persist returnTo separately because some Supabase redirect allow-lists are exact-match only.
  return `${origin}/auth/callback`;
};

const sendMagicLink = async () => {
  status.value = '';
  error.value = '';

  if (!supabase) {
    error.value = 'Supabase client is not available.';
    return;
  }

  if (!email.value.trim()) {
    error.value = 'Enter a valid email address.';
    return;
  }

  busy.value = true;

  persistReturnTo();
  const redirectTo = buildRedirectTo();
  const { error: signInError } = await supabase.auth.signInWithOtp({
    email: email.value.trim(),
    options: {
      emailRedirectTo: redirectTo,
    },
  });

  busy.value = false;

  if (signInError) {
    error.value = signInError.message;
    return;
  }

  status.value = 'Check your inbox for the magic link.';
};

const signInWithApple = async () => {
  status.value = '';
  error.value = '';

  if (!supabase) {
    error.value = 'Supabase client is not available.';
    return;
  }

  busy.value = true;
  persistReturnTo();
  const redirectTo = buildRedirectTo();
  const { error: signInError } = await supabase.auth.signInWithOAuth({
    provider: 'apple',
    options: {
      redirectTo,
    },
  });

  busy.value = false;

  if (signInError) {
    error.value = signInError.message;
  }
};

const signInWithGoogle = async () => {
  status.value = '';
  error.value = '';

  if (!supabase) {
    error.value = 'Supabase client is not available.';
    return;
  }

  busy.value = true;
  persistReturnTo();
  const redirectTo = buildRedirectTo();
  const { error: signInError } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo,
    },
  });

  busy.value = false;

  if (signInError) {
    error.value = signInError.message;
  }
};
</script>
