<template>
  <Card data-test="settings-card">
    <template #title>
      <div class="flex items-center gap-3">
        <i class="pi pi-cog text-primary" aria-hidden="true" />
        <div>
          <p class="font-serif text-xl font-semibold tracking-tight">Profile and settings</p>
          <p class="text-sm text-[var(--p-text-muted-color)]">
            Manage your profile and external book search preferences.
          </p>
        </div>
      </div>
    </template>
    <template #content>
      <div class="flex flex-col gap-4">
        <Message v-if="error" severity="error" :closable="false" data-test="settings-error">
          {{ error }}
        </Message>
        <Message v-if="saved" severity="success" :closable="false" data-test="settings-saved">
          Settings saved.
        </Message>

        <div class="grid gap-3 md:grid-cols-2">
          <div class="flex flex-col gap-2">
            <label class="text-sm font-medium" for="settings-handle">Handle</label>
            <InputText
              id="settings-handle"
              v-model="handle"
              data-test="settings-handle"
              placeholder="reader_handle"
            />
          </div>
          <div class="flex flex-col gap-2">
            <label class="text-sm font-medium" for="settings-display-name">Display name</label>
            <InputText
              id="settings-display-name"
              v-model="displayName"
              data-test="settings-display-name"
              placeholder="Display name"
            />
          </div>
        </div>

        <div class="flex flex-col gap-2">
          <label class="text-sm font-medium" for="settings-avatar-url">Avatar URL</label>
          <InputText
            id="settings-avatar-url"
            v-model="avatarUrl"
            data-test="settings-avatar-url"
            placeholder="https://example.com/avatar.jpg"
          />
        </div>

        <Card>
          <template #content>
            <div class="flex items-start justify-between gap-4">
              <div>
                <p class="m-0 text-sm font-medium">Use Google Books</p>
                <p class="m-0 text-xs text-[var(--p-text-muted-color)]">
                  Opt in to include Google Books in global search and import results.
                </p>
              </div>
              <input
                v-model="enableGoogleBooks"
                data-test="settings-enable-google-books"
                type="checkbox"
                class="mt-1 h-4 w-4"
              />
            </div>
          </template>
        </Card>

        <div class="flex justify-end">
          <Button
            :disabled="saving || loading"
            :label="saving ? 'Saving...' : 'Save settings'"
            data-test="settings-save"
            @click="save"
          />
        </div>
      </div>
    </template>
  </Card>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import Button from 'primevue/button';
import Card from 'primevue/card';
import InputText from 'primevue/inputtext';
import Message from 'primevue/message';
import { ApiClientError, apiRequest } from '~/utils/api';

definePageMeta({ layout: 'app', middleware: 'auth' });

type MeProfile = {
  handle: string;
  display_name: string | null;
  avatar_url: string | null;
  enable_google_books: boolean;
};

const loading = ref(false);
const saving = ref(false);
const saved = ref(false);
const error = ref('');

const handle = ref('');
const displayName = ref('');
const avatarUrl = ref('');
const enableGoogleBooks = ref(false);

const loadProfile = async () => {
  loading.value = true;
  error.value = '';
  try {
    const data = await apiRequest<MeProfile>('/api/v1/me');
    handle.value = data.handle;
    displayName.value = data.display_name ?? '';
    avatarUrl.value = data.avatar_url ?? '';
    enableGoogleBooks.value = Boolean(data.enable_google_books);
  } catch (err) {
    error.value = err instanceof ApiClientError ? err.message : 'Unable to load settings.';
  } finally {
    loading.value = false;
  }
};

const save = async () => {
  saving.value = true;
  saved.value = false;
  error.value = '';
  try {
    await apiRequest('/api/v1/me', {
      method: 'PATCH',
      body: {
        handle: handle.value,
        display_name: displayName.value,
        avatar_url: avatarUrl.value,
        enable_google_books: enableGoogleBooks.value,
      },
    });
    saved.value = true;
  } catch (err) {
    error.value = err instanceof ApiClientError ? err.message : 'Unable to save settings.';
  } finally {
    saving.value = false;
  }
};

onMounted(() => {
  void loadProfile();
});
</script>
