<template>
  <Card data-test="search-card">
    <template #title>
      <div class="flex items-center justify-between gap-4">
        <div class="flex items-center gap-3">
          <i class="pi pi-search text-primary" aria-hidden="true"></i>
          <div>
            <p class="font-serif text-xl font-semibold tracking-tight">Search and import books</p>
            <p class="text-sm text-[var(--p-text-muted-color)]">
              Import from Open Library into your library.
            </p>
          </div>
        </div>
        <Button asChild v-slot="slotProps" size="small" severity="secondary" variant="outlined">
          <NuxtLink to="/library" :class="slotProps.class">View library</NuxtLink>
        </Button>
      </div>
    </template>
    <template #content>
      <div class="flex flex-col gap-4">
        <Card>
          <template #content>
            <div class="grid w-full gap-3 md:grid-cols-[1fr_220px]">
              <InputText
                v-model="query"
                class="w-full"
                placeholder="Search Open Library"
                data-test="search-input"
              />
              <Select
                v-model="status"
                :options="statusOptions"
                option-label="label"
                option-value="value"
                data-test="status-select"
              />
            </div>
          </template>
        </Card>

        <p v-if="hint" class="text-sm text-[var(--p-text-muted-color)]" data-test="search-hint">
          {{ hint }}
        </p>
        <Message v-if="error" severity="error" :closable="false" data-test="search-error">{{
          error
        }}</Message>

        <!-- Skeleton loading -->
        <div v-if="loading" class="grid gap-3 md:grid-cols-2" data-test="search-loading">
          <Card v-for="n in 4" :key="n">
            <template #content>
              <div class="flex flex-col gap-3">
                <Skeleton width="75%" height="1.25rem" />
                <Skeleton width="50%" height="1rem" />
                <Skeleton width="25%" height="0.75rem" />
                <Skeleton width="100%" height="2.25rem" borderRadius="0.5rem" class="mt-auto" />
              </div>
            </template>
          </Card>
        </div>

        <div
          v-else-if="results.length"
          class="grid gap-3 md:grid-cols-2"
          data-test="search-results"
        >
          <Card v-for="(book, index) in results" :key="book.work_key">
            <template #content>
              <div class="flex h-full items-start gap-4">
                <div
                  class="h-[120px] w-[80px] shrink-0 overflow-hidden rounded-lg border border-[var(--p-content-border-color)] bg-black/5 dark:bg-white/5"
                  data-test="search-item-thumb"
                >
                  <Image
                    v-if="book.cover_url"
                    :src="book.cover_url"
                    alt=""
                    :preview="false"
                    class="h-full w-full"
                    image-class="h-full w-full object-cover"
                    data-test="search-item-cover"
                  />
                  <Skeleton
                    v-else
                    class="h-full w-full"
                    borderRadius="0.5rem"
                    data-test="search-item-cover-skeleton"
                  />
                </div>

                <div class="flex h-full min-w-0 flex-1 flex-col gap-3">
                  <div class="min-w-0">
                    <p class="font-serif text-base font-semibold tracking-tight">
                      {{ book.title }}
                    </p>
                    <p class="truncate text-sm text-[var(--p-text-muted-color)]">
                      {{ book.author_names.join(', ') || 'Unknown author' }}
                    </p>
                    <p
                      v-if="book.first_publish_year"
                      class="text-xs text-[var(--p-text-muted-color)]"
                    >
                      First published: {{ book.first_publish_year }}
                    </p>
                  </div>

                  <Button
                    label="Import and add"
                    class="mt-auto self-start"
                    :loading="importingWorkKey === book.work_key"
                    :data-test="`search-add-${index}`"
                    @click="importAndAdd(book.work_key)"
                  />
                </div>
              </div>
            </template>
          </Card>
        </div>
      </div>
    </template>
  </Card>
</template>

<script setup lang="ts">
definePageMeta({ layout: 'app', middleware: 'auth' });

import { onBeforeUnmount, ref, watch } from 'vue';
import { useToast } from 'primevue/usetoast';
import { ApiClientError, apiRequest } from '~/utils/api';

const toast = useToast();

type SearchItem = {
  work_key: string;
  title: string;
  author_names: string[];
  first_publish_year: number | null;
  cover_url: string | null;
};

const query = ref('');
const status = ref('to_read');
const loading = ref(false);
const results = ref<SearchItem[]>([]);
const error = ref('');
const message = ref('');
const hint = ref('Type at least 2 characters to search.');
const importingWorkKey = ref<string | null>(null);

const statusOptions = [
  { label: 'To read', value: 'to_read' },
  { label: 'Reading', value: 'reading' },
  { label: 'Completed', value: 'completed' },
];

let searchTimer: ReturnType<typeof globalThis.setTimeout> | null = null;

const runSearch = async () => {
  const trimmed = query.value.trim();
  if (trimmed.length < 2) {
    results.value = [];
    hint.value = 'Type at least 2 characters to search.';
    return;
  }

  loading.value = true;
  error.value = '';
  message.value = '';
  hint.value = '';

  try {
    const payload = await apiRequest<{ items: SearchItem[] }>('/api/v1/books/search', {
      query: {
        query: trimmed,
        limit: 10,
        page: 1,
      },
    });
    results.value = payload.items;
    if (!payload.items.length) {
      hint.value = 'No books found. Try another search.';
    }
  } catch (err) {
    results.value = [];
    if (err instanceof ApiClientError) {
      error.value = err.message;
    } else {
      error.value = 'Unable to search books right now.';
    }
  } finally {
    loading.value = false;
  }
};

const importAndAdd = async (workKey: string) => {
  error.value = '';
  message.value = '';

  importingWorkKey.value = workKey;

  try {
    const imported = await apiRequest<{ work: { id: string } }>('/api/v1/books/import', {
      method: 'POST',
      body: { work_key: workKey },
    });

    const libraryResult = await apiRequest<{ created: boolean }>('/api/v1/library/items', {
      method: 'POST',
      body: {
        work_id: imported.work.id,
        status: status.value,
      },
    });

    const msg = libraryResult.created
      ? 'Book imported and added to your library.'
      : 'Book is already in your library.';
    toast.add({ severity: 'success', summary: msg, life: 3000 });
  } catch (err) {
    if (err instanceof ApiClientError) {
      error.value = err.message;
    } else {
      error.value = 'Unable to import this book right now.';
    }
  } finally {
    importingWorkKey.value = null;
  }
};

watch(query, () => {
  if (searchTimer) {
    globalThis.clearTimeout(searchTimer);
  }
  searchTimer = globalThis.setTimeout(() => {
    void runSearch();
  }, 300);
});

onBeforeUnmount(() => {
  if (searchTimer) {
    globalThis.clearTimeout(searchTimer);
  }
});
</script>
