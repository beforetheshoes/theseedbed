<template>
  <div>
    <!-- Large screens: centered popover search -->
    <div
      v-show="!mobileOpen"
      class="absolute left-1/2 top-1/2 hidden -translate-x-1/2 -translate-y-1/2 lg:block"
      data-test="topbar-book-search-desktop"
    >
      <div class="flex w-[min(760px,92vw)] items-center gap-2 lg:w-[min(760px,52vw)]">
        <div ref="anchorEl" class="flex flex-1">
          <InputGroup class="w-full">
            <InputText
              v-model="query"
              placeholder="Find a book"
              class="w-full"
              data-test="topbar-search-input"
              @focus="onFocus"
            />
            <InputGroupAddon v-if="query.trim().length">
              <Button
                icon="pi pi-times"
                variant="text"
                severity="secondary"
                size="small"
                aria-label="Clear search"
                data-test="topbar-search-clear"
                @click="clear"
              />
            </InputGroupAddon>
          </InputGroup>
        </div>

        <SelectButton
          v-model="scope"
          :options="scopeOptions"
          optionLabel="label"
          optionValue="value"
          data-test="topbar-search-scope"
        />
      </div>
      <Popover
        ref="popoverRef"
        :dismissable="true"
        appendTo="body"
        data-test="topbar-search-popover"
      >
        <div class="w-[min(760px,92vw)] p-2 lg:w-[min(760px,52vw)]">
          <div class="mb-2 grid grid-cols-3 gap-2">
            <InputText
              v-model="languageFilter"
              class="w-full"
              placeholder="Lang (eng)"
              data-test="topbar-search-language"
            />
            <InputText
              v-model="yearFromFilter"
              class="w-full"
              placeholder="Year from"
              data-test="topbar-search-year-from"
            />
            <InputText
              v-model="yearToFilter"
              class="w-full"
              placeholder="Year to"
              data-test="topbar-search-year-to"
            />
          </div>

          <Message
            v-if="errorMessage"
            severity="error"
            :closable="false"
            class="mb-2"
            data-test="topbar-search-error"
          >
            {{ errorMessage }}
          </Message>

          <div
            v-if="loading"
            class="grid grid-cols-3 items-start gap-3"
            data-test="topbar-search-loading"
          >
            <Card v-for="n in 9" :key="n">
              <template #content>
                <div class="flex flex-col gap-3">
                  <Skeleton width="70%" height="1rem" />
                  <Skeleton width="45%" height="0.875rem" />
                  <Skeleton width="100%" height="2rem" />
                </div>
              </template>
            </Card>
          </div>

          <div
            v-else-if="visibleItems.length"
            class="grid grid-cols-3 items-start gap-3"
            data-test="topbar-search-results"
          >
            <div v-for="item in visibleItems" :key="itemKey(item)" class="min-w-0">
              <Fieldset
                :legend="desktopLegend(item)"
                :pt="{
                  root: {
                    class:
                      'min-w-0 h-full rounded-xl overflow-hidden border border-[var(--p-content-border-color)] !bg-transparent',
                  },
                  legendLabel: { class: 'text-xs font-medium tracking-wide' },
                  content: { class: 'min-w-0 p-0 !bg-transparent' },
                }"
              >
                <button
                  type="button"
                  class="flex min-w-0 w-full appearance-none items-start gap-3 border-0 bg-transparent px-3 py-2 text-left transition-colors hover:bg-black/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--p-primary-color)] dark:hover:bg-white/5"
                  :disabled="isTileDisabled(item)"
                  :data-test="
                    item.kind === 'library'
                      ? `topbar-search-open-${item.work_id}`
                      : `topbar-search-add-${item.work_key}`
                  "
                  @click="onDesktopTileClick(item)"
                >
                  <div
                    class="h-24 w-16 shrink-0 overflow-hidden rounded bg-black/5 dark:bg-white/5"
                  >
                    <img
                      v-if="item.cover_url"
                      :src="item.cover_url"
                      alt=""
                      class="h-full w-full object-cover"
                    />
                    <div v-else class="flex h-full w-full items-center justify-center">
                      <span class="pi pi-image text-xs text-[var(--p-text-muted-color)]" />
                    </div>
                  </div>
                  <div class="min-w-0 flex-1">
                    <p
                      class="m-0 overflow-hidden p-0 text-sm font-medium leading-snug [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:3]"
                    >
                      {{ item.kind === 'library' ? item.work_title : item.title }}
                    </p>
                    <p
                      class="m-0 mt-0.5 overflow-hidden p-0 text-xs leading-snug text-[var(--p-text-muted-color)] [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]"
                    >
                      {{ (item.author_names ?? []).join(', ') || 'Unknown author' }}
                    </p>
                    <p
                      v-if="item.kind !== 'library' && isAdding(item.work_key)"
                      class="m-0 mt-1 text-xs text-[var(--p-text-muted-color)]"
                    >
                      Adding...
                    </p>
                    <p
                      v-if="item.kind === 'googlebooks' && item.attribution?.text"
                      class="m-0 mt-1 text-[10px] text-[var(--p-text-muted-color)]"
                    >
                      {{ item.attribution.text }}
                    </p>
                  </div>
                </button>
              </Fieldset>
            </div>
          </div>

          <div
            v-else
            class="px-2 py-3 text-sm text-[var(--p-text-muted-color)]"
            data-test="topbar-search-hint"
          >
            {{
              query.trim().length < 2
                ? 'Type at least 2 characters to search.'
                : 'No books found. Try another search.'
            }}
          </div>
        </div>
      </Popover>
    </div>

    <!-- Mobile and tablet: button that opens a dialog -->
    <Button
      class="lg:hidden"
      icon="pi pi-search"
      variant="text"
      severity="secondary"
      aria-label="Search"
      data-test="topbar-search-mobile-open"
      @click="openMobileDialog"
    />

    <Dialog
      v-model:visible="mobileOpen"
      header="Search"
      modal
      :dismissableMask="true"
      :draggable="false"
      :breakpoints="{ '640px': '95vw' }"
      style="width: 32rem"
      data-test="topbar-search-mobile-dialog"
    >
      <div class="flex flex-col gap-3">
        <div class="flex flex-col gap-2">
          <InputGroup>
            <InputText
              v-model="query"
              placeholder="Find a book"
              class="w-full"
              data-test="topbar-search-input-mobile"
            />
            <InputGroupAddon v-if="query.trim().length">
              <Button
                icon="pi pi-times"
                variant="text"
                severity="secondary"
                size="small"
                aria-label="Clear search"
                data-test="topbar-search-clear-mobile"
                @click="clear"
              />
            </InputGroupAddon>
          </InputGroup>

          <SelectButton
            v-model="scope"
            :options="scopeOptions"
            optionLabel="label"
            optionValue="value"
            data-test="topbar-search-scope-mobile"
          />
          <div class="grid grid-cols-3 gap-2">
            <InputText
              v-model="languageFilter"
              placeholder="Lang"
              data-test="topbar-search-language-mobile"
            />
            <InputText
              v-model="yearFromFilter"
              placeholder="Year from"
              data-test="topbar-search-year-from-mobile"
            />
            <InputText
              v-model="yearToFilter"
              placeholder="Year to"
              data-test="topbar-search-year-to-mobile"
            />
          </div>
        </div>

        <Message
          v-if="errorMessage"
          severity="error"
          :closable="false"
          data-test="topbar-search-error-mobile"
        >
          {{ errorMessage }}
        </Message>

        <div v-if="loading" class="grid grid-cols-2 gap-3" data-test="topbar-search-loading-mobile">
          <Card v-for="n in 4" :key="n">
            <template #content>
              <div class="flex flex-col gap-3">
                <Skeleton width="70%" height="1rem" />
                <Skeleton width="45%" height="0.875rem" />
                <Skeleton width="100%" height="2rem" />
              </div>
            </template>
          </Card>
        </div>

        <div
          v-else-if="visibleItems.length"
          class="grid grid-cols-2 gap-3"
          data-test="topbar-search-results-mobile"
        >
          <div v-for="item in visibleItems" :key="itemKey(item)" class="min-w-0">
            <Fieldset
              :legend="desktopLegend(item)"
              :pt="{
                root: {
                  class:
                    'min-w-0 h-full rounded-xl overflow-hidden border border-[var(--p-content-border-color)] !bg-transparent',
                },
                legendLabel: { class: 'text-xs font-medium tracking-wide' },
                content: { class: 'min-w-0 p-0 !bg-transparent' },
              }"
            >
              <button
                type="button"
                class="flex min-w-0 w-full appearance-none items-start gap-3 border-0 bg-transparent px-3 py-2 text-left transition-colors hover:bg-black/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--p-primary-color)] dark:hover:bg-white/5"
                :disabled="isTileDisabled(item)"
                :data-test="
                  item.kind === 'library'
                    ? `topbar-search-open-mobile-${item.work_id}`
                    : `topbar-search-add-mobile-${item.work_key}`
                "
                @click="onMobileTileClick(item)"
              >
                <div class="h-24 w-16 shrink-0 overflow-hidden rounded bg-black/5 dark:bg-white/5">
                  <img
                    v-if="item.cover_url"
                    :src="item.cover_url"
                    alt=""
                    class="h-full w-full object-cover"
                  />
                  <div v-else class="flex h-full w-full items-center justify-center">
                    <span class="pi pi-image text-xs text-[var(--p-text-muted-color)]" />
                  </div>
                </div>
                <div class="min-w-0 flex-1">
                  <p
                    class="m-0 overflow-hidden p-0 text-sm font-medium leading-snug [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:3]"
                  >
                    {{ item.kind === 'library' ? item.work_title : item.title }}
                  </p>
                  <p
                    class="m-0 mt-0.5 overflow-hidden p-0 text-xs leading-snug text-[var(--p-text-muted-color)] [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]"
                  >
                    {{ (item.author_names ?? []).join(', ') || 'Unknown author' }}
                  </p>
                  <p
                    v-if="item.kind !== 'library' && isAdding(item.work_key)"
                    class="m-0 mt-1 text-xs text-[var(--p-text-muted-color)]"
                  >
                    Adding...
                  </p>
                  <p
                    v-if="item.kind === 'googlebooks' && item.attribution?.text"
                    class="m-0 mt-1 text-[10px] text-[var(--p-text-muted-color)]"
                  >
                    {{ item.attribution.text }}
                  </p>
                </div>
              </button>
            </Fieldset>
          </div>
        </div>

        <div
          v-else
          class="text-sm text-[var(--p-text-muted-color)]"
          data-test="topbar-search-hint-mobile"
        >
          {{
            query.trim().length < 2
              ? 'Type at least 2 characters to search.'
              : 'No books found. Try another search.'
          }}
        </div>

        <div class="flex items-center justify-end">
          <Button
            label="Close"
            severity="secondary"
            variant="text"
            data-test="topbar-search-mobile-close"
            @click="mobileOpen = false"
          />
        </div>
      </div>
    </Dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { navigateTo } from '#imports';
import Button from 'primevue/button';
import Card from 'primevue/card';
import Dialog from 'primevue/dialog';
import Fieldset from 'primevue/fieldset';
import InputGroup from 'primevue/inputgroup';
import InputGroupAddon from 'primevue/inputgroupaddon';
import InputText from 'primevue/inputtext';
import Message from 'primevue/message';
import Popover from 'primevue/popover';
import SelectButton from 'primevue/selectbutton';
import Skeleton from 'primevue/skeleton';
import { useToast } from 'primevue/usetoast';
import { ApiClientError, apiRequest } from '~/utils/api';

type LibrarySearchItem = {
  kind: 'library';
  work_id: string;
  work_title: string;
  author_names: string[];
  cover_url: string | null;
  openlibrary_work_key: string | null;
};

type OpenLibrarySearchItem = {
  kind: 'openlibrary';
  source: 'openlibrary';
  source_id: string;
  work_key: string;
  title: string;
  author_names: string[];
  cover_url: string | null;
  first_publish_year: number | null;
  edition_count?: number | null;
  languages?: string[];
  readable?: boolean;
  attribution?: null;
};

type GoogleBooksSearchItem = {
  kind: 'googlebooks';
  source: 'googlebooks';
  source_id: string;
  work_key: string;
  title: string;
  author_names: string[];
  cover_url: string | null;
  first_publish_year: number | null;
  edition_count?: number | null;
  languages?: string[];
  readable?: boolean;
  attribution?: { text: string; url: string | null } | null;
};

type ExternalSearchItem = OpenLibrarySearchItem | GoogleBooksSearchItem;
type SearchOption = LibrarySearchItem | ExternalSearchItem;
type SearchScope = 'my' | 'global' | 'both';
const LIBRARY_UPDATED_EVENT = 'chapterverse:library-updated';

const toast = useToast();

const mobileOpen = ref(false);
const query = ref('');
const scope = ref<SearchScope>('both');
const languageFilter = ref('');
const yearFromFilter = ref('');
const yearToFilter = ref('');
const scopeOptions = [
  { label: 'My Library', value: 'my' },
  { label: 'Global', value: 'global' },
  { label: 'Both', value: 'both' },
];

const popoverRef = ref<InstanceType<typeof Popover> | null>(null);
const anchorEl = ref<HTMLElement | null>(null);

const loading = ref(false);
const errorMessage = ref('');
const libraryItems = ref<LibrarySearchItem[]>([]);
const openLibraryItems = ref<ExternalSearchItem[]>([]);

const addedKeys = ref(new Set<string>());
const addingKeys = ref(new Set<string>());

let requestSeq = 0;
let searchTimer: ReturnType<typeof globalThis.setTimeout> | null = null;

const clearTimer = () => {
  if (searchTimer) {
    globalThis.clearTimeout(searchTimer);
    searchTimer = null;
  }
};

const visibleItems = computed<SearchOption[]>(() => {
  const items: SearchOption[] = [];
  if (scope.value === 'my' || scope.value === 'both') {
    items.push(...libraryItems.value);
  }
  if (scope.value === 'global' || scope.value === 'both') {
    items.push(...openLibraryItems.value);
  }
  return items.slice(0, 9);
});

const itemKey = (item: SearchOption) =>
  item.kind === 'library' ? `lib:${item.work_id}` : `ol:${item.work_key}`;

const openPopover = () => {
  if (mobileOpen.value) {
    return;
  }
  const target = anchorEl.value;
  if (!target) {
    return;
  }
  popoverRef.value?.show({ currentTarget: target } as any);
};

const hidePopover = () => {
  popoverRef.value?.hide();
};

const resetResults = () => {
  libraryItems.value = [];
  openLibraryItems.value = [];
};

const clear = () => {
  query.value = '';
  errorMessage.value = '';
  loading.value = false;
  resetResults();
  clearTimer();
  hidePopover();
};

const openMobileDialog = () => {
  hidePopover();
  mobileOpen.value = true;
};

const runSearch = async (trimmed: string) => {
  const currentSeq = ++requestSeq;
  loading.value = true;
  errorMessage.value = '';
  openPopover();

  try {
    let nextLibrary: LibrarySearchItem[] = [];
    let nextOpenLibrary: ExternalSearchItem[] = [];

    if (scope.value === 'my' || scope.value === 'both') {
      const payload = await apiRequest<{ items: Omit<LibrarySearchItem, 'kind'>[] }>(
        '/api/v1/library/search',
        { query: { query: trimmed, limit: 10 } },
      );
      if (currentSeq !== requestSeq) {
        return;
      }
      nextLibrary = payload.items.map((item) => ({ kind: 'library', ...item }));
    }

    const libraryKeys = new Set(
      nextLibrary.map((item) => item.openlibrary_work_key).filter(Boolean) as string[],
    );

    if (scope.value === 'global' || scope.value === 'both') {
      const parsedYearFrom = Number.parseInt(yearFromFilter.value.trim(), 10);
      const parsedYearTo = Number.parseInt(yearToFilter.value.trim(), 10);
      const queryParams: Record<string, string | number> = {
        query: trimmed,
        limit: 10,
        page: 1,
      };
      const language = languageFilter.value.trim();
      if (language) {
        queryParams.language = language;
      }
      if (!Number.isNaN(parsedYearFrom)) {
        queryParams.first_publish_year_from = parsedYearFrom;
      }
      if (!Number.isNaN(parsedYearTo)) {
        queryParams.first_publish_year_to = parsedYearTo;
      }
      const payload = await apiRequest<{
        items: Array<
          Omit<OpenLibrarySearchItem, 'kind' | 'source' | 'source_id'> & {
            source?: string;
            source_id?: string;
            attribution?: { text?: unknown; url?: unknown } | null;
          }
        >;
      }>('/api/v1/books/search', { query: queryParams });
      if (currentSeq !== requestSeq) {
        return;
      }
      nextOpenLibrary = payload.items
        .map((item) => {
          const source = item.source === 'googlebooks' ? 'googlebooks' : 'openlibrary';
          const sourceId =
            typeof item.source_id === 'string' && item.source_id.trim().length > 0
              ? item.source_id
              : source === 'openlibrary'
                ? item.work_key
                : item.work_key.replace(/^googlebooks:/, '');
          const base = {
            source,
            source_id: sourceId,
            work_key:
              source === 'openlibrary' ? item.work_key : item.work_key || `googlebooks:${sourceId}`,
            title: item.title,
            author_names: item.author_names ?? [],
            cover_url: item.cover_url ?? null,
            first_publish_year:
              typeof item.first_publish_year === 'number' ? item.first_publish_year : null,
            edition_count: typeof item.edition_count === 'number' ? item.edition_count : null,
            languages: Array.isArray(item.languages)
              ? item.languages.filter((value): value is string => typeof value === 'string')
              : [],
            readable: Boolean(item.readable),
          };
          if (source === 'googlebooks') {
            return {
              kind: 'googlebooks' as const,
              ...base,
              attribution:
                item.attribution &&
                typeof item.attribution.text === 'string' &&
                item.attribution.text.trim()
                  ? {
                      text: item.attribution.text.trim(),
                      url: typeof item.attribution.url === 'string' ? item.attribution.url : null,
                    }
                  : null,
            };
          }
          return {
            kind: 'openlibrary' as const,
            ...base,
            attribution: null,
          };
        })
        .filter((item) => (scope.value === 'both' ? !libraryKeys.has(item.work_key) : true));
    }

    libraryItems.value = nextLibrary;
    openLibraryItems.value = nextOpenLibrary;
  } catch (err) {
    if (currentSeq !== requestSeq) {
      return;
    }
    resetResults();
    errorMessage.value =
      err instanceof ApiClientError ? err.message : 'Unable to search right now.';
  } finally {
    if (currentSeq === requestSeq) {
      loading.value = false;
    }
  }
};

const scheduleSearch = (immediate: boolean) => {
  const trimmed = query.value.trim();
  if (trimmed.length < 2) {
    resetResults();
    errorMessage.value = '';
    loading.value = false;
    clearTimer();
    hidePopover();
    return;
  }

  clearTimer();
  if (immediate) {
    void runSearch(trimmed);
    return;
  }

  searchTimer = globalThis.setTimeout(() => {
    void runSearch(trimmed);
  }, 300);
};

watch(query, () => scheduleSearch(false));
watch(scope, () => scheduleSearch(true));
watch([languageFilter, yearFromFilter, yearToFilter], () => scheduleSearch(true));

const onFocus = () => {
  // Open the popover immediately when refocusing with an active query.
  if (query.value.trim().length >= 2) {
    openPopover();
  }
};

const isAdding = (workKey: string) => addingKeys.value.has(workKey);
const isAdded = (workKey: string) => addedKeys.value.has(workKey);
const isTileDisabled = (item: SearchOption) =>
  item.kind !== 'library' && (isAdding(item.work_key) || isAdded(item.work_key));

const desktopLegend = (item: SearchOption) => {
  if (item.kind === 'library') {
    return 'In Library';
  }
  if (isAdded(item.work_key)) {
    return 'Added';
  }
  return item.kind === 'googlebooks' ? 'Google Books' : 'Open Library';
};

const onDesktopTileClick = async (item: SearchOption) => {
  if (item.kind === 'library') {
    await openLibraryItem(item);
    return;
  }
  await addOpenLibraryItem(item);
};

const onMobileTileClick = async (item: SearchOption) => {
  await onDesktopTileClick(item);
};

const openLibraryItem = async (item: LibrarySearchItem) => {
  clear();
  mobileOpen.value = false;
  await navigateTo(`/books/${item.work_id}`);
};

const addOpenLibraryItem = async (item: ExternalSearchItem) => {
  if (isAdding(item.work_key) || isAdded(item.work_key)) {
    return;
  }

  addingKeys.value.add(item.work_key);
  addingKeys.value = new Set(addingKeys.value);
  try {
    const imported = await apiRequest<{ work: { id: string } }>('/api/v1/books/import', {
      method: 'POST',
      body:
        item.kind === 'googlebooks'
          ? { source: 'googlebooks', source_id: item.source_id }
          : { source: 'openlibrary', work_key: item.work_key },
    });
    const libraryResult = await apiRequest<{ created: boolean }>('/api/v1/library/items', {
      method: 'POST',
      body: { work_id: imported.work.id, status: 'to_read' },
    });

    addedKeys.value.add(item.work_key);
    addedKeys.value = new Set(addedKeys.value);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event(LIBRARY_UPDATED_EVENT));
    }
    toast.add({
      severity: 'success',
      summary: libraryResult.created
        ? 'Book added to your library.'
        : 'Book is already in your library.',
      life: 2500,
    });
  } catch (err) {
    const msg = err instanceof ApiClientError ? err.message : 'Unable to add this book right now.';
    toast.add({ severity: 'error', summary: msg, life: 3000 });
  } finally {
    addingKeys.value.delete(item.work_key);
    addingKeys.value = new Set(addingKeys.value);
  }
};

onBeforeUnmount(() => {
  clearTimer();
});
</script>
