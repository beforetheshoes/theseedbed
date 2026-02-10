<template>
  <Card data-test="library-card">
    <template #title>
      <div class="flex items-center justify-between gap-4">
        <div class="flex items-center gap-3">
          <i class="pi pi-book text-primary" aria-hidden="true"></i>
          <div>
            <p class="font-serif text-xl font-semibold tracking-tight">Your library</p>
            <p class="text-sm text-[var(--p-text-muted-color)]">
              Filter, sort, and jump back into a book.
            </p>
          </div>
        </div>
        <Button asChild v-slot="slotProps" size="small">
          <NuxtLink to="/books/search" :class="slotProps.class">Add books</NuxtLink>
        </Button>
      </div>
    </template>
    <template #content>
      <div class="flex flex-col gap-4">
        <Card>
          <template #content>
            <div class="grid w-full grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Select
                v-model="statusFilter"
                :options="statusFilters"
                option-label="label"
                option-value="value"
                data-test="library-status-filter"
                class="min-w-0 w-full"
              />
              <InputText
                v-model="tagFilter"
                placeholder="Filter by tag"
                data-test="library-tag-filter"
                class="min-w-0 w-full"
              />
              <Select
                v-model="sortMode"
                :options="sortOptions"
                option-label="label"
                option-value="value"
                data-test="library-sort-select"
                class="min-w-0 w-full"
              />
            </div>
          </template>
        </Card>

        <Message v-if="error" severity="error" :closable="false" data-test="library-error">{{
          error
        }}</Message>

        <!-- Skeleton loading -->
        <div v-if="loading" class="grid gap-3" data-test="library-loading">
          <Card v-for="n in 4" :key="n">
            <template #content>
              <div class="flex items-start gap-4">
                <Skeleton width="80px" height="120px" borderRadius="0.5rem" class="shrink-0" />
                <div class="flex flex-1 flex-col gap-2 pt-1">
                  <Skeleton width="75%" height="1.25rem" />
                  <Skeleton width="50%" height="1rem" />
                  <div class="mt-2 flex gap-2">
                    <Skeleton width="4rem" height="1.25rem" borderRadius="9999px" />
                    <Skeleton width="3.5rem" height="1.25rem" borderRadius="9999px" />
                  </div>
                </div>
              </div>
            </template>
          </Card>
        </div>

        <div v-else-if="displayItems.length" class="grid gap-3" data-test="library-items">
          <NuxtLink
            v-for="item in displayItems"
            :key="item.id"
            :to="`/books/${item.work_id}`"
            class="block"
          >
            <Card>
              <template #content>
                <div class="flex items-start gap-4">
                  <div
                    class="h-[120px] w-[80px] shrink-0 overflow-hidden rounded-lg border border-[var(--p-content-border-color)] bg-black/5 dark:bg-white/5"
                  >
                    <Image
                      v-if="item.cover_url"
                      :src="item.cover_url"
                      alt=""
                      :preview="false"
                      class="h-full w-full"
                      image-class="h-full w-full object-cover"
                      data-test="library-item-cover"
                    />
                    <Skeleton
                      v-else
                      class="h-full w-full"
                      borderRadius="0.5rem"
                      data-test="library-item-cover-skeleton"
                    />
                  </div>

                  <div class="min-w-0 pt-1">
                    <p class="truncate font-serif text-base font-semibold tracking-tight">
                      {{ item.work_title }}
                    </p>
                    <p
                      v-if="item.author_names?.length"
                      class="truncate text-sm text-[var(--p-text-muted-color)]"
                    >
                      {{ item.author_names.join(', ') }}
                    </p>
                    <div class="mt-3 flex flex-wrap items-center gap-2">
                      <Tag :value="libraryStatusLabel(item.status)" severity="secondary" />
                      <Tag
                        v-for="tag in (item.tags || []).slice(0, 3)"
                        :key="tag"
                        :value="tag"
                        severity="info"
                      />
                    </div>
                  </div>
                </div>
              </template>
            </Card>
          </NuxtLink>
        </div>

        <EmptyState
          v-else
          data-test="library-empty"
          icon="pi pi-inbox"
          title="No library items found."
          body="Search for a book to import it into your library."
        >
          <template #action>
            <Button asChild v-slot="slotProps">
              <NuxtLink to="/books/search" :class="slotProps.class">
                <i class="pi pi-search" aria-hidden="true"></i>
                Add a book
              </NuxtLink>
            </Button>
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
</template>

<script setup lang="ts">
definePageMeta({ layout: 'app', middleware: 'auth' });

import { computed, onMounted, ref, watch } from 'vue';
import { ApiClientError, apiRequest } from '~/utils/api';
import { libraryStatusLabel } from '~/utils/libraryStatus';
import EmptyState from '~/components/EmptyState.vue';

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

const fetchPage = async (append = false) => {
  error.value = '';
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
