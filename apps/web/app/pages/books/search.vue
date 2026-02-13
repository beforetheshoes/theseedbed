<template>
  <Card data-test="search-card">
    <template #title>
      <div class="flex items-center justify-between gap-4">
        <div class="flex items-center gap-3">
          <i class="pi pi-search text-primary" aria-hidden="true"></i>
          <div>
            <p class="font-serif text-xl font-semibold tracking-tight">Search and import books</p>
            <p class="text-sm text-[var(--p-text-muted-color)]">
              Import from Open Library, with optional Google Books results when enabled.
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
                placeholder="Search books"
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
            <div class="grid w-full gap-3 md:grid-cols-2 lg:grid-cols-3" data-test="search-filters">
              <InputText
                v-model="authorFilter"
                placeholder="Author filter"
                data-test="search-author"
              />
              <InputText
                v-model="subjectFilter"
                placeholder="Subject filter"
                data-test="search-subject"
              />
              <InputText
                v-model="languageFilter"
                placeholder="Language code (e.g. eng)"
                data-test="search-language"
              />
              <InputText
                v-model="yearFromFilter"
                placeholder="Year from"
                data-test="search-year-from"
              />
              <InputText v-model="yearToFilter" placeholder="Year to" data-test="search-year-to" />
              <Select
                v-model="sort"
                :options="sortOptions"
                option-label="label"
                option-value="value"
                data-test="search-sort"
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
                  <img
                    v-if="shouldRenderCover(book)"
                    :src="book.cover_url || ''"
                    alt=""
                    class="h-full w-full object-cover"
                    data-test="search-item-cover"
                    @error="onCoverError(book.work_key)"
                  />
                  <CoverPlaceholder v-else data-test="search-item-cover-placeholder" />
                </div>

                <div class="flex h-full min-w-0 flex-1 flex-col gap-3">
                  <div class="min-w-0">
                    <p class="font-serif text-base font-semibold tracking-tight">
                      {{ book.title }}
                    </p>
                    <p class="truncate text-sm text-[var(--p-text-muted-color)]">
                      {{ book.author_names.join(', ') || 'Unknown author' }}
                    </p>
                    <p class="text-xs text-[var(--p-text-muted-color)]">
                      Source: {{ book.source === 'googlebooks' ? 'Google Books' : 'Open Library' }}
                    </p>
                    <p
                      v-if="book.source === 'googlebooks' && book.attribution?.text"
                      class="text-xs text-[var(--p-text-muted-color)]"
                    >
                      {{ book.attribution.text }}
                    </p>
                    <p
                      v-if="book.first_publish_year"
                      class="text-xs text-[var(--p-text-muted-color)]"
                    >
                      First published: {{ book.first_publish_year }}
                    </p>
                    <p class="text-xs text-[var(--p-text-muted-color)]">
                      <span v-if="book.edition_count !== null"
                        >Editions: {{ book.edition_count }}</span
                      >
                      <span v-if="book.languages.length">
                        <template v-if="book.edition_count !== null"> | </template>
                        Languages: {{ book.languages.join(', ') }}
                      </span>
                      <span>
                        <template v-if="book.edition_count !== null || book.languages.length">
                          |
                        </template>
                        {{ book.readable ? 'Readable online' : 'Metadata only' }}
                      </span>
                    </p>
                  </div>

                  <Button
                    :label="addButtonLabel(book.work_key)"
                    class="mt-auto self-start"
                    :loading="importingWorkKey === book.work_key"
                    :disabled="isAddButtonDisabled(book.work_key)"
                    :data-test="`search-add-${index}`"
                    @click="importAndAdd(book)"
                  />
                </div>
              </div>
            </template>
          </Card>

          <Button
            v-if="nextPage !== null"
            label="Load more"
            class="md:col-span-2 justify-self-start"
            :loading="loadingMore"
            data-test="search-load-more"
            @click="loadMore"
          />
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
import CoverPlaceholder from '~/components/CoverPlaceholder.vue';

const toast = useToast();

type SearchItem = {
  source: 'openlibrary' | 'googlebooks';
  source_id: string;
  work_key: string;
  title: string;
  author_names: string[];
  first_publish_year: number | null;
  cover_url: string | null;
  edition_count: number | null;
  languages: string[];
  readable: boolean;
  attribution?: { text: string; url: string | null } | null;
};

type SearchResponse = {
  items: Array<
    Omit<SearchItem, 'edition_count' | 'languages' | 'readable'> & {
      edition_count?: number | null;
      languages?: string[];
      readable?: boolean;
      source?: string;
      source_id?: string;
      attribution?: { text?: unknown; url?: unknown } | null;
    }
  >;
  next_page: number | null;
};

type AddedStatus = 'added' | 'already_exists';

const LIBRARY_UPDATED_EVENT = 'chapterverse:library-updated';

const query = ref('');
const status = ref('to_read');
const authorFilter = ref('');
const subjectFilter = ref('');
const languageFilter = ref('');
const yearFromFilter = ref('');
const yearToFilter = ref('');
const sort = ref<'relevance' | 'new' | 'old'>('relevance');
const loading = ref(false);
const loadingMore = ref(false);
const results = ref<SearchItem[]>([]);
const nextPage = ref<number | null>(null);
const error = ref('');
const hint = ref('Type at least 2 characters to search.');
const importingWorkKey = ref<string | null>(null);
const activeQuery = ref('');
const brokenCoverKeys = ref(new Set<string>());
const addedStatusByWorkKey = ref<Record<string, AddedStatus>>({});

const statusOptions = [
  { label: 'To read', value: 'to_read' },
  { label: 'Reading', value: 'reading' },
  { label: 'Completed', value: 'completed' },
];
const sortOptions = [
  { label: 'Relevance', value: 'relevance' },
  { label: 'Newest first', value: 'new' },
  { label: 'Oldest first', value: 'old' },
];

const parsedYear = (value: string): number | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) ? parsed : null;
};

let searchTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
let searchRequestSeq = 0;

const shouldRenderCover = (book: SearchItem): boolean =>
  Boolean(book.cover_url) && !brokenCoverKeys.value.has(book.work_key);

const onCoverError = (workKey: string) => {
  const next = new Set(brokenCoverKeys.value);
  next.add(workKey);
  brokenCoverKeys.value = next;
};

const addButtonLabel = (workKey: string): string => {
  const addedStatus = addedStatusByWorkKey.value[workKey];
  if (addedStatus === 'added') return 'Added';
  if (addedStatus === 'already_exists') return 'Already in library';
  return 'Import and add';
};

const isAddButtonDisabled = (workKey: string): boolean =>
  Boolean(addedStatusByWorkKey.value[workKey]) || importingWorkKey.value === workKey;

const normalizeSearchItem = (item: SearchResponse['items'][number]): SearchItem => ({
  ...item,
  source: item.source === 'googlebooks' ? 'googlebooks' : 'openlibrary',
  source_id:
    typeof item.source_id === 'string' && item.source_id.trim()
      ? item.source_id
      : item.source === 'googlebooks'
        ? item.work_key.replace(/^googlebooks:/, '')
        : item.work_key,
  edition_count: typeof item.edition_count === 'number' ? item.edition_count : null,
  languages: Array.isArray(item.languages)
    ? item.languages.filter((value): value is string => typeof value === 'string')
    : [],
  readable: Boolean(item.readable),
  attribution:
    item.attribution && typeof item.attribution.text === 'string' && item.attribution.text.trim()
      ? {
          text: item.attribution.text.trim(),
          url: typeof item.attribution.url === 'string' ? item.attribution.url : null,
        }
      : null,
});

const fetchSearchPage = async (page: number): Promise<SearchResponse> => {
  const yearFrom = parsedYear(yearFromFilter.value);
  const yearTo = parsedYear(yearToFilter.value);
  return apiRequest<SearchResponse>('/api/v1/books/search', {
    query: {
      query: activeQuery.value,
      limit: 10,
      page,
      sort: sort.value,
      ...(authorFilter.value.trim() ? { author: authorFilter.value.trim() } : {}),
      ...(subjectFilter.value.trim() ? { subject: subjectFilter.value.trim() } : {}),
      ...(languageFilter.value.trim() ? { language: languageFilter.value.trim() } : {}),
      ...(yearFrom !== null ? { first_publish_year_from: yearFrom } : {}),
      ...(yearTo !== null ? { first_publish_year_to: yearTo } : {}),
    },
  });
};

const runSearch = async () => {
  const trimmed = query.value.trim();
  if (trimmed.length < 2) {
    results.value = [];
    nextPage.value = null;
    activeQuery.value = '';
    brokenCoverKeys.value = new Set();
    addedStatusByWorkKey.value = {};
    error.value = '';
    hint.value = 'Type at least 2 characters to search.';
    return;
  }

  const currentSeq = ++searchRequestSeq;
  activeQuery.value = trimmed;
  loading.value = true;
  error.value = '';
  hint.value = '';

  try {
    const payload = await fetchSearchPage(1);
    if (currentSeq !== searchRequestSeq) {
      return;
    }
    results.value = payload.items.map(normalizeSearchItem);
    nextPage.value = payload.next_page;
    brokenCoverKeys.value = new Set();
    addedStatusByWorkKey.value = {};
    if (!payload.items.length) {
      hint.value = 'No books found. Try another search.';
    }
  } catch (err) {
    if (currentSeq !== searchRequestSeq) {
      return;
    }
    results.value = [];
    nextPage.value = null;
    if (err instanceof ApiClientError) {
      error.value = err.message;
    } else {
      error.value = 'Unable to search books right now.';
    }
  } finally {
    if (currentSeq === searchRequestSeq) {
      loading.value = false;
    }
  }
};

const importAndAdd = async (book: SearchItem) => {
  const workKey = book.work_key;
  if (isAddButtonDisabled(workKey)) return;
  error.value = '';

  importingWorkKey.value = workKey;

  try {
    const imported = await apiRequest<{ work: { id: string } }>('/api/v1/books/import', {
      method: 'POST',
      body:
        book.source === 'googlebooks'
          ? { source: 'googlebooks', source_id: book.source_id }
          : { source: 'openlibrary', work_key: workKey },
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
    addedStatusByWorkKey.value = {
      ...addedStatusByWorkKey.value,
      [workKey]: libraryResult.created ? 'added' : 'already_exists',
    };
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event(LIBRARY_UPDATED_EVENT));
    }
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

const loadMore = async () => {
  if (nextPage.value === null || loadingMore.value) return;
  const page = nextPage.value;
  const queryAtRequest = activeQuery.value;

  loadingMore.value = true;
  error.value = '';

  try {
    const payload = await fetchSearchPage(page);
    if (queryAtRequest !== activeQuery.value) {
      return;
    }

    const seen = new Set(results.value.map((item) => item.work_key));
    const nextItems = payload.items
      .map(normalizeSearchItem)
      .filter((item) => !seen.has(item.work_key));
    results.value = [...results.value, ...nextItems];
    nextPage.value = payload.next_page;
  } catch (err) {
    if (queryAtRequest !== activeQuery.value) {
      return;
    }
    if (err instanceof ApiClientError) {
      error.value = err.message;
    } else {
      error.value = 'Unable to load more books right now.';
    }
  } finally {
    loadingMore.value = false;
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

watch([authorFilter, subjectFilter, languageFilter, yearFromFilter, yearToFilter, sort], () => {
  if (activeQuery.value) {
    void runSearch();
  }
});

onBeforeUnmount(() => {
  if (searchTimer) {
    globalThis.clearTimeout(searchTimer);
  }
});
</script>
