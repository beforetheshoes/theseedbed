<template>
  <div class="sticky top-0 z-40">
    <Menubar :model="[]" class="rounded-none border-x-0 border-t-0 px-3 md:px-5">
      <template #start>
        <div class="flex items-center gap-2">
          <Button
            v-if="showSidebarToggle"
            class="md:hidden"
            icon="pi pi-bars"
            variant="text"
            severity="secondary"
            aria-label="Open navigation"
            data-test="app-nav-open"
            @click="$emit('toggleSidebar')"
          />

          <Button
            variant="text"
            severity="secondary"
            data-test="topbar-home"
            aria-label="Home"
            @click="goHome"
          >
            <span class="pi pi-book mr-2 text-primary" aria-hidden="true" />
            <span class="text-lg font-semibold tracking-tight">The Seedbed</span>
          </Button>
        </div>
      </template>

      <template #end>
        <div class="flex items-center gap-2">
          <!-- Global search (authed only) -->
          <div v-if="userEmail" class="flex items-center gap-2">
            <div class="hidden items-center gap-2 md:flex">
              <AutoComplete
                v-model="searchValue"
                :suggestions="searchGroups"
                optionGroupLabel="label"
                optionGroupChildren="items"
                :optionLabel="optionLabel"
                :autoOptionFocus="false"
                :focusOnHover="false"
                :minLength="2"
                :delay="300"
                showClear
                :loading="searchLoading"
                :placeholder="searchPlaceholder"
                class="w-[min(420px,42vw)]"
                data-test="navbar-search"
                @complete="onSearchComplete"
                @item-select="onSearchSelect"
              >
                <template #optiongroup="{ option }">
                  <div
                    class="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--p-text-muted-color)]"
                    :data-test="`navbar-search-group-${String(option.label)
                      .toLowerCase()
                      .replace(/\s+/g, '-')}`"
                  >
                    {{ option.label }}
                  </div>
                </template>
                <template #option="{ option }">
                  <div class="flex items-center gap-3 px-3 py-2">
                    <div
                      class="h-10 w-7 shrink-0 overflow-hidden rounded border border-[var(--p-content-border-color)] bg-black/5 dark:bg-white/5"
                    >
                      <img
                        v-if="option.cover_url"
                        :src="option.cover_url"
                        alt=""
                        class="h-full w-full object-cover"
                      />
                      <div v-else class="flex h-full w-full items-center justify-center">
                        <span class="pi pi-image text-xs text-[var(--p-text-muted-color)]" />
                      </div>
                    </div>
                    <div class="min-w-0">
                      <p class="truncate text-sm font-medium">
                        {{ option.kind === 'library' ? option.work_title : option.title }}
                      </p>
                      <p class="truncate text-xs text-[var(--p-text-muted-color)]">
                        {{
                          (option.kind === 'library'
                            ? option.author_names
                            : option.author_names
                          )?.join(', ') || 'Unknown author'
                        }}
                      </p>
                    </div>
                    <div class="ml-auto">
                      <span
                        v-if="option.kind === 'library'"
                        class="text-xs text-[var(--p-text-muted-color)]"
                      >
                        Open
                      </span>
                      <span v-else class="text-xs font-medium text-[var(--p-primary-color)]">
                        Add
                      </span>
                    </div>
                  </div>
                </template>
              </AutoComplete>

              <div class="flex items-center gap-2 pl-1" data-test="navbar-search-toggle">
                <ToggleSwitch
                  v-model="includeNonLibrary"
                  aria-label="Include books not in my library"
                  data-test="navbar-search-include-toggle"
                />
                <span class="text-xs text-[var(--p-text-muted-color)]"> Include Open Library </span>
              </div>
            </div>

            <Button
              class="md:hidden"
              icon="pi pi-search"
              variant="text"
              severity="secondary"
              aria-label="Search"
              data-test="navbar-search-open"
              @click="mobileSearchOpen = true"
            />

            <Dialog
              v-model:visible="mobileSearchOpen"
              header="Search"
              modal
              :dismissableMask="true"
              :draggable="false"
              :breakpoints="{ '640px': '95vw' }"
              style="width: 32rem"
              data-test="navbar-search-dialog"
            >
              <div class="flex flex-col gap-3">
                <AutoComplete
                  v-model="searchValue"
                  :suggestions="searchGroups"
                  optionGroupLabel="label"
                  optionGroupChildren="items"
                  :optionLabel="optionLabel"
                  :autoOptionFocus="false"
                  :focusOnHover="false"
                  :minLength="2"
                  :delay="300"
                  appendTo="self"
                  showClear
                  :loading="searchLoading"
                  :placeholder="searchPlaceholder"
                  class="w-full"
                  data-test="navbar-search-mobile"
                  @complete="onSearchComplete"
                  @item-select="onSearchSelect"
                >
                  <template #optiongroup="{ option }">
                    <div class="px-3 py-2 text-xs font-semibold uppercase tracking-wide">
                      {{ option.label }}
                    </div>
                  </template>
                  <template #option="{ option }">
                    <div class="flex items-center gap-3 px-3 py-2">
                      <div
                        class="h-10 w-7 shrink-0 overflow-hidden rounded border border-[var(--p-content-border-color)] bg-black/5 dark:bg-white/5"
                      >
                        <img
                          v-if="option.cover_url"
                          :src="option.cover_url"
                          alt=""
                          class="h-full w-full object-cover"
                        />
                        <div v-else class="flex h-full w-full items-center justify-center">
                          <span class="pi pi-image text-xs text-[var(--p-text-muted-color)]" />
                        </div>
                      </div>
                      <div class="min-w-0">
                        <p class="truncate text-sm font-medium">
                          {{ option.kind === 'library' ? option.work_title : option.title }}
                        </p>
                        <p class="truncate text-xs text-[var(--p-text-muted-color)]">
                          {{
                            (option.kind === 'library'
                              ? option.author_names
                              : option.author_names
                            )?.join(', ') || 'Unknown author'
                          }}
                        </p>
                      </div>
                      <div class="ml-auto">
                        <span
                          v-if="option.kind === 'library'"
                          class="text-xs text-[var(--p-text-muted-color)]"
                        >
                          Open
                        </span>
                        <span v-else class="text-xs font-medium text-[var(--p-primary-color)]">
                          Add
                        </span>
                      </div>
                    </div>
                  </template>
                </AutoComplete>

                <div class="flex items-center justify-between gap-3">
                  <div class="flex items-center gap-2">
                    <ToggleSwitch
                      v-model="includeNonLibrary"
                      aria-label="Include books not in my library"
                      data-test="navbar-search-include-toggle-mobile"
                    />
                    <span class="text-sm">Include Open Library</span>
                  </div>
                  <Button
                    label="Close"
                    severity="secondary"
                    variant="text"
                    data-test="navbar-search-close"
                    @click="mobileSearchOpen = false"
                  />
                </div>
              </div>
            </Dialog>
          </div>

          <Dialog
            v-model:visible="addConfirmOpen"
            header="Add book"
            modal
            :dismissableMask="true"
            :draggable="false"
            style="width: 30rem"
            data-test="navbar-search-add-dialog"
          >
            <div class="flex flex-col gap-4">
              <div>
                <p class="text-sm text-[var(--p-text-muted-color)]">
                  Add this book to your library?
                </p>
                <p class="mt-2 text-base font-semibold" data-test="navbar-search-add-title">
                  {{ pendingAdd?.title ?? '' }}
                </p>
                <p
                  class="text-sm text-[var(--p-text-muted-color)]"
                  data-test="navbar-search-add-authors"
                >
                  {{ (pendingAdd?.author_names ?? []).join(', ') || 'Unknown author' }}
                </p>
              </div>

              <div class="flex items-center justify-end gap-2">
                <Button
                  label="Cancel"
                  severity="secondary"
                  variant="text"
                  data-test="navbar-search-add-cancel"
                  @click="cancelAddConfirm"
                />
                <Button
                  label="Add"
                  :loading="addConfirmLoading"
                  data-test="navbar-search-add-confirm"
                  @click="confirmAdd"
                />
              </div>
            </div>
          </Dialog>

          <!-- On very small viewports, collapse theme controls into a popup to avoid horizontal overflow. -->
          <div class="hidden items-center gap-1 sm:flex" aria-label="Color mode">
            <Button
              icon="pi pi-desktop"
              :variant="mode === 'system' ? 'outlined' : 'text'"
              severity="secondary"
              size="small"
              aria-label="System theme"
              data-test="color-mode-system"
              @click="setAndToast('system')"
            />
            <Button
              icon="pi pi-sun"
              :variant="mode === 'light' ? 'outlined' : 'text'"
              severity="secondary"
              size="small"
              aria-label="Light theme"
              data-test="color-mode-light"
              @click="setAndToast('light')"
            />
            <Button
              icon="pi pi-moon"
              :variant="mode === 'dark' ? 'outlined' : 'text'"
              severity="secondary"
              size="small"
              aria-label="Dark theme"
              data-test="color-mode-dark"
              @click="setAndToast('dark')"
            />
          </div>

          <Button
            class="sm:hidden"
            icon="pi pi-palette"
            variant="text"
            severity="secondary"
            size="small"
            aria-label="Theme menu"
            data-test="color-mode-menu"
            @click="toggleColorMenu"
          />
          <Menu ref="colorMenu" :model="colorItems" popup />

          <Button
            v-if="userEmail"
            icon="pi pi-user"
            variant="text"
            severity="secondary"
            aria-label="Account"
            data-test="account-open"
            @click="toggleAccountMenu"
          />
          <Button v-else asChild v-slot="slotProps" data-test="account-signin">
            <NuxtLink to="/login" :class="slotProps.class">Sign in</NuxtLink>
          </Button>
          <Menu ref="accountMenu" :model="accountItems" popup />
        </div>
      </template>
    </Menubar>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { navigateTo, useSupabaseClient } from '#imports';
import AutoComplete from 'primevue/autocomplete';
import Button from 'primevue/button';
import Dialog from 'primevue/dialog';
import Menubar from 'primevue/menubar';
import Menu from 'primevue/menu';
import ToggleSwitch from 'primevue/toggleswitch';
import { useToast } from 'primevue/usetoast';
import type { ColorMode } from '~/composables/useColorMode';
import { useColorMode } from '~/composables/useColorMode';
import { ApiClientError, apiRequest } from '~/utils/api';

withDefaults(
  defineProps<{
    showSidebarToggle?: boolean;
  }>(),
  { showSidebarToggle: false },
);

defineEmits<{
  toggleSidebar: [];
}>();

const supabase = useSupabaseClient();
const toast = useToast();
const userEmail = ref<string | null>(null);

const { mode, setMode } = useColorMode();

const accountMenu = ref<InstanceType<typeof Menu> | null>(null);
const colorMenu = ref<InstanceType<typeof Menu> | null>(null);

const logoTarget = computed(() => '/');

const goHome = async () => {
  await navigateTo(logoTarget.value);
};

const toggleAccountMenu = (event: Event) => {
  accountMenu.value?.toggle(event);
};

const toggleColorMenu = (event: Event) => {
  colorMenu.value?.toggle(event);
};

const setAndToast = (value: ColorMode) => {
  setMode(value);
  toast.add({
    severity: 'info',
    summary: 'Theme updated',
    detail: value === 'system' ? 'Following system theme.' : `Switched to ${value} mode.`,
    life: 2200,
  });
};

const signOut = async () => {
  if (!supabase) {
    return;
  }
  await supabase.auth.signOut();
  userEmail.value = null;
  toast.add({ severity: 'success', summary: 'Signed out', life: 2000 });
  await navigateTo('/');
};

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
  work_key: string;
  title: string;
  author_names: string[];
  cover_url: string | null;
  first_publish_year: number | null;
};

type SearchOption = LibrarySearchItem | OpenLibrarySearchItem;
type SearchGroup = { label: string; items: SearchOption[] };

const mobileSearchOpen = ref(false);
const includeNonLibrary = ref(true);
const searchValue = ref<SearchOption | string>('');
const searchGroups = ref<SearchGroup[]>([]);
const searchLoading = ref(false);
let searchRequestSeq = 0;

const searchPlaceholder = computed(() => 'Find a book');

const addConfirmOpen = ref(false);
const addConfirmLoading = ref(false);
const pendingAdd = ref<OpenLibrarySearchItem | null>(null);

const optionLabel = (opt: SearchOption | string) => {
  if (typeof opt === 'string') {
    return opt;
  }
  return opt.kind === 'library' ? opt.work_title : opt.title;
};

const clearSearch = () => {
  searchValue.value = '';
  searchGroups.value = [];
};

const cancelAddConfirm = () => {
  addConfirmOpen.value = false;
  pendingAdd.value = null;
};

const confirmAdd = async () => {
  if (!pendingAdd.value) {
    return;
  }
  try {
    addConfirmLoading.value = true;
    const imported = await apiRequest<{ work: { id: string } }>('/api/v1/books/import', {
      method: 'POST',
      body: { work_key: pendingAdd.value.work_key },
    });
    const libraryResult = await apiRequest<{ created: boolean }>('/api/v1/library/items', {
      method: 'POST',
      body: { work_id: imported.work.id, status: 'to_read' },
    });
    toast.add({
      severity: 'success',
      summary: libraryResult.created
        ? 'Book added to your library.'
        : 'Book is already in your library.',
      life: 2500,
    });
    addConfirmOpen.value = false;
    pendingAdd.value = null;
    await navigateTo(`/books/${imported.work.id}`);
  } catch (err) {
    const msg = err instanceof ApiClientError ? err.message : 'Unable to add this book right now.';
    toast.add({ severity: 'error', summary: msg, life: 3000 });
  } finally {
    addConfirmLoading.value = false;
  }
};

const onSearchComplete = async (event: { query: string }) => {
  const trimmed = (event.query ?? '').trim();
  if (trimmed.length < 2) {
    searchGroups.value = [];
    return;
  }

  const requestSeq = ++searchRequestSeq;
  searchLoading.value = true;
  try {
    const libraryPayload = await apiRequest<{ items: Omit<LibrarySearchItem, 'kind'>[] }>(
      '/api/v1/library/search',
      { query: { query: trimmed, limit: 10 } },
    );
    if (requestSeq !== searchRequestSeq) {
      return;
    }
    const libraryItems: LibrarySearchItem[] = libraryPayload.items.map((item) => ({
      kind: 'library',
      ...item,
    }));

    const libraryKeys = new Set(
      libraryItems.map((item) => item.openlibrary_work_key).filter(Boolean) as string[],
    );

    let openLibraryItems: OpenLibrarySearchItem[] = [];
    if (includeNonLibrary.value) {
      const openLibraryPayload = await apiRequest<{ items: Omit<OpenLibrarySearchItem, 'kind'>[] }>(
        '/api/v1/books/search',
        { query: { query: trimmed, limit: 10, page: 1 } },
      );
      if (requestSeq !== searchRequestSeq) {
        return;
      }
      openLibraryItems = openLibraryPayload.items
        .map((item) => ({ kind: 'openlibrary', ...item }))
        .filter((item) => !libraryKeys.has(item.work_key));
    }

    const groups: SearchGroup[] = [];
    if (libraryItems.length) {
      groups.push({ label: 'In your library', items: libraryItems });
    }
    if (openLibraryItems.length) {
      groups.push({ label: 'Add to library', items: openLibraryItems });
    }
    searchGroups.value = groups;
  } catch (err) {
    if (requestSeq !== searchRequestSeq) {
      return;
    }
    searchGroups.value = [];
    const msg = err instanceof ApiClientError ? err.message : 'Unable to search right now.';
    toast.add({ severity: 'error', summary: msg, life: 3000 });
  } finally {
    if (requestSeq === searchRequestSeq) {
      searchLoading.value = false;
    }
  }
};

const onSearchSelect = async (event: { value: SearchOption }) => {
  const value = event.value;
  if (value.kind === 'library') {
    clearSearch();
    mobileSearchOpen.value = false;
    await navigateTo(`/books/${value.work_id}`);
    return;
  }

  // Don't auto-add on selection. It's too easy to select an item while scrolling.
  pendingAdd.value = value;
  addConfirmOpen.value = true;
  clearSearch();
  mobileSearchOpen.value = false;
};

const colorItems = computed(() => [
  {
    label: 'System',
    icon: 'pi pi-desktop',
    command: () => setAndToast('system'),
    'data-test': 'color-mode-system',
  },
  {
    label: 'Light',
    icon: 'pi pi-sun',
    command: () => setAndToast('light'),
    'data-test': 'color-mode-light',
  },
  {
    label: 'Dark',
    icon: 'pi pi-moon',
    command: () => setAndToast('dark'),
    'data-test': 'color-mode-dark',
  },
]);

const accountItems = computed(() => [
  userEmail.value
    ? { label: userEmail.value, icon: 'pi pi-envelope', disabled: true }
    : { label: 'Not signed in', icon: 'pi pi-user', disabled: true },
  { separator: true },
  ...(userEmail.value
    ? [{ label: 'Sign out', icon: 'pi pi-sign-out', command: () => void signOut() }]
    : [
        {
          label: 'Sign in',
          icon: 'pi pi-sign-in',
          command: () => void navigateTo('/login'),
        },
      ]),
]);

onMounted(async () => {
  if (!supabase) {
    return;
  }
  const { data } = await supabase.auth.getUser();
  userEmail.value = data.user?.email ?? null;

  if (!userEmail.value) {
    clearSearch();
  }
});
</script>
