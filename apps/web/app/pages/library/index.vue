<template>
  <PageShell>
    <Card class="shadow-lg" data-test="library-card">
      <template #title>
        <SectionHeader icon="pi pi-book text-emerald-600" title="Your library">
          <template #actions>
            <NuxtLink
              to="/books/search"
              class="text-sm font-medium text-emerald-700 hover:underline"
            >
              Add books
            </NuxtLink>
          </template>
        </SectionHeader>
      </template>
      <template #content>
        <div class="flex flex-col gap-4">
          <div class="grid gap-4 md:grid-cols-[240px_220px_220px_1fr]">
            <Select
              v-model="statusFilter"
              :options="statusFilters"
              option-label="label"
              option-value="value"
              data-test="library-status-filter"
            />
            <InputText
              v-model="tagFilter"
              placeholder="Filter by tag"
              data-test="library-tag-filter"
            />
            <Select
              v-model="sortMode"
              :options="sortOptions"
              option-label="label"
              option-value="value"
              data-test="library-sort-select"
            />
          </div>

          <InlineAlert v-if="error" tone="error" :message="error" data-test="library-error" />
          <NuxtLink
            v-if="authRequired"
            :to="loginHref"
            class="text-sm font-medium text-emerald-700 hover:underline"
            data-test="library-login-link"
          >
            Sign in to continue
          </NuxtLink>

          <div v-if="loading" class="text-sm text-slate-600" data-test="library-loading">
            Loading...
          </div>

          <div v-if="displayItems.length" class="grid gap-3" data-test="library-items">
            <Card v-for="item in displayItems" :key="item.id" class="border border-slate-200/70">
              <template #content>
                <div class="flex items-start justify-between gap-4">
                  <div class="flex min-w-0 items-start gap-4">
                    <div
                      class="h-16 w-12 overflow-hidden rounded border border-slate-200/70 bg-slate-100"
                    >
                      <img
                        v-if="item.cover_url"
                        :src="item.cover_url"
                        alt=""
                        class="h-full w-full object-cover"
                        data-test="library-item-cover"
                      />
                      <div
                        v-else
                        class="flex h-full w-full items-center justify-center"
                        data-test="library-item-cover-fallback"
                      >
                        <i class="pi pi-image text-slate-400" aria-hidden="true"></i>
                      </div>
                    </div>

                    <div class="min-w-0">
                      <NuxtLink
                        :to="`/books/${item.work_id}`"
                        class="block truncate font-semibold text-slate-900 hover:underline"
                      >
                        {{ item.work_title }}
                      </NuxtLink>
                      <p v-if="item.author_names?.length" class="truncate text-sm text-slate-600">
                        {{ item.author_names.join(', ') }}
                      </p>
                      <div class="mt-2 flex flex-wrap items-center gap-2">
                        <span class="rounded bg-slate-100 px-2 py-1 text-xs text-slate-700">
                          {{ statusLabel(item.status) }}
                        </span>
                        <span
                          class="rounded bg-slate-100 px-2 py-1 text-xs uppercase text-slate-600"
                        >
                          {{ item.visibility }}
                        </span>
                        <span
                          v-for="tag in (item.tags || []).slice(0, 3)"
                          :key="tag"
                          class="rounded bg-emerald-50 px-2 py-1 text-xs text-emerald-700"
                        >
                          {{ tag }}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </template>
            </Card>
          </div>

          <EmptyState
            v-else-if="!loading"
            data-test="library-empty"
            icon="pi pi-inbox"
            title="No library items found."
            body="Search for a book to import it into your library."
          >
            <template #action>
              <NuxtLink
                to="/books/search"
                class="inline-flex items-center gap-2 rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500"
              >
                <i class="pi pi-search" aria-hidden="true"></i>
                Add a book
              </NuxtLink>
            </template>
          </EmptyState>

          <Button
            v-if="nextCursor"
            label="Load more"
            class="self-start"
            :loading="loadingMore"
            data-test="library-load-more"
            @click="loadMore"
          />
        </div>
      </template>
    </Card>
  </PageShell>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute } from '#imports';
import Button from 'primevue/button';
import Card from 'primevue/card';
import InputText from 'primevue/inputtext';
import Select from 'primevue/select';
import { ApiClientError, apiRequest } from '~/utils/api';
import EmptyState from '~/components/EmptyState.vue';
import InlineAlert from '~/components/InlineAlert.vue';
import PageShell from '~/components/PageShell.vue';
import SectionHeader from '~/components/SectionHeader.vue';

type LibraryItem = {
  id: string;
  work_id: string;
  work_title: string;
  author_names?: string[];
  cover_url?: string | null;
  status: string;
  visibility: string;
  tags?: string[];
  created_at?: string;
};

const items = ref<LibraryItem[]>([]);
const statusFilter = ref<string>('');
const tagFilter = ref('');
const sortMode = ref<'newest' | 'oldest' | 'title_asc'>('newest');
const nextCursor = ref<string | null>(null);
const loading = ref(false);
const loadingMore = ref(false);
const error = ref('');
const authRequired = ref(false);
const route = useRoute();
const loginHref = computed(
  () => `/login?returnTo=${encodeURIComponent(route.fullPath || '/library')}`,
);

const statusFilters = [
  { label: 'All statuses', value: '' },
  { label: 'To read', value: 'to_read' },
  { label: 'Reading', value: 'reading' },
  { label: 'Completed', value: 'completed' },
];

const sortOptions = [
  { label: 'Newest first', value: 'newest' },
  { label: 'Oldest first', value: 'oldest' },
  { label: 'Title A-Z', value: 'title_asc' },
];

const displayItems = computed(() => {
  const tag = tagFilter.value.trim().toLowerCase();
  let filtered = items.value;
  if (tag) {
    filtered = filtered.filter((item) =>
      Array.isArray(item.tags) ? item.tags.some((t) => t.toLowerCase().includes(tag)) : false,
    );
  }

  const sorted = [...filtered];
  if (sortMode.value === 'title_asc') {
    sorted.sort((a, b) => a.work_title.localeCompare(b.work_title));
  } else if (sortMode.value === 'oldest') {
    sorted.sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));
  } else {
    sorted.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  }
  return sorted;
});

const statusLabel = (value: string): string => {
  const map: Record<string, string> = {
    to_read: 'To read',
    reading: 'Reading',
    completed: 'Completed',
    abandoned: 'Abandoned',
  };
  return map[value] || value;
};

const fetchPage = async (append = false) => {
  error.value = '';
  authRequired.value = false;
  if (append) {
    loadingMore.value = true;
  } else {
    loading.value = true;
  }

  try {
    const payload = await apiRequest<{ items: LibraryItem[]; next_cursor: string | null }>(
      '/api/v1/library/items',
      {
        query: {
          limit: 10,
          cursor: append ? nextCursor.value : undefined,
          status: statusFilter.value || undefined,
        },
      },
    );

    items.value = append ? [...items.value, ...payload.items] : payload.items;
    nextCursor.value = payload.next_cursor;
  } catch (err) {
    if (err instanceof ApiClientError) {
      error.value = err.message;
      authRequired.value = err.code === 'auth_required';
    } else {
      error.value = 'Unable to load library items right now.';
    }
  } finally {
    loading.value = false;
    loadingMore.value = false;
  }
};

const loadMore = async () => {
  await fetchPage(true);
};

watch(statusFilter, () => {
  void fetchPage(false);
});

onMounted(() => {
  void fetchPage(false);
});
</script>
