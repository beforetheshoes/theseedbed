<template>
  <Card class="overflow-hidden">
    <template #title>
      <div class="flex items-center gap-3">
        <Avatar
          icon="pi pi-compass"
          shape="circle"
          aria-hidden="true"
          class="ring-1 ring-amber-400/40"
        />
        <div class="flex flex-col">
          <span class="font-serif text-lg font-semibold tracking-tight">Discovery</span>
          <span class="text-xs font-normal text-[var(--p-text-muted-color)]"
            >Recommended from related titles and your authors</span
          >
        </div>
      </div>
    </template>
    <template #content>
      <div class="space-y-6">
        <section class="space-y-2">
          <p class="text-sm font-medium">Related books</p>
          <p v-if="relatedLoading" class="text-sm text-[var(--p-text-muted-color)]">Loading…</p>
          <div
            v-else-if="visibleRelatedBooks.length"
            class="grid grid-cols-[repeat(auto-fill,minmax(8.25rem,1fr))] gap-2"
          >
            <button
              v-for="item in visibleRelatedBooks"
              :key="item.work_key"
              type="button"
              class="group overflow-hidden rounded-xl border border-[var(--p-content-border-color)] bg-[var(--p-content-background)] text-left shadow-sm transition hover:-translate-y-0.5 hover:border-[var(--p-primary-color)]/30 hover:shadow-md"
              :data-test="`related-book-${item.work_key}`"
              @click="importAndOpenRelated(item.work_key)"
            >
              <div class="p-1 pb-0">
                <div
                  class="aspect-[3/4] w-full overflow-hidden rounded-md bg-black/5 dark:bg-white/10"
                >
                  <img
                    :src="item.cover_url as string"
                    alt=""
                    class="block h-full w-full object-cover object-center transition duration-300 group-hover:scale-[1.02]"
                  />
                </div>
              </div>
              <div class="flex min-h-[6.75rem] flex-col gap-0.5 p-2">
                <p class="min-h-[2.5rem] text-xs font-semibold leading-snug">
                  {{ item.title }}
                </p>
                <p class="text-[11px] leading-snug text-[var(--p-text-muted-color)]">
                  {{ relatedAuthorLabel(item) }}
                </p>
                <p class="mt-auto text-xs text-[var(--p-text-muted-color)]">
                  {{ item.first_publish_year ?? 'Year unknown' }}
                </p>
              </div>
            </button>
          </div>
          <p v-else class="text-sm text-[var(--p-text-muted-color)]">
            No related books with covers yet.
          </p>
        </section>

        <section class="space-y-2">
          <p class="text-sm font-medium">More from the author(s)</p>
          <p v-if="authorLoading" class="text-sm text-[var(--p-text-muted-color)]">Loading…</p>
          <div v-else-if="authorProfilesWithCoverWorks.length" class="grid gap-3">
            <Card
              v-for="author in authorProfilesWithCoverWorks"
              :key="author.id"
              class="overflow-hidden"
            >
              <template #content>
                <div class="flex items-center gap-3">
                  <div
                    class="h-12 w-12 shrink-0 overflow-hidden rounded-full border border-[var(--p-content-border-color)] bg-black/5 dark:bg-white/5"
                  >
                    <img
                      v-if="author.photo_url"
                      :src="author.photo_url"
                      alt=""
                      class="h-full w-full object-cover"
                    />
                    <div v-else class="flex h-full w-full items-center justify-center">
                      <span class="pi pi-user text-sm text-[var(--p-text-muted-color)]" />
                    </div>
                  </div>
                  <div class="min-w-0">
                    <p class="text-sm font-medium">{{ author.name }}</p>
                    <p
                      v-if="author.bio"
                      class="line-clamp-1 text-xs text-[var(--p-text-muted-color)]"
                    >
                      {{ author.bio }}
                    </p>
                  </div>
                </div>
                <div class="mt-3 grid grid-cols-[repeat(auto-fill,minmax(7.7rem,1fr))] gap-2">
                  <button
                    v-for="book in author.works.slice(0, 6)"
                    :key="`${author.id}-${book.work_key}`"
                    type="button"
                    class="group overflow-hidden rounded-lg border border-[var(--p-content-border-color)] bg-[var(--p-content-background)] text-left transition hover:border-[var(--p-primary-color)]/30"
                    :data-test="`author-work-${book.work_key}`"
                    @click="importAndOpenRelated(book.work_key)"
                  >
                    <div class="p-1 pb-0">
                      <div
                        class="aspect-[3/4] w-full overflow-hidden rounded-md bg-black/5 dark:bg-white/10"
                      >
                        <img
                          :src="book.cover_url as string"
                          alt=""
                          class="block h-full w-full object-cover object-center transition duration-300 group-hover:scale-[1.02]"
                        />
                      </div>
                    </div>
                    <div class="p-2">
                      <p class="text-[11px] font-medium leading-snug">{{ book.title }}</p>
                    </div>
                  </button>
                </div>
              </template>
            </Card>
          </div>
          <p v-else class="text-sm text-[var(--p-text-muted-color)]">
            No author books with covers yet.
          </p>
        </section>
      </div>
    </template>
  </Card>
</template>

<script setup lang="ts">
import { navigateTo } from '#imports';
import { computed, onMounted, ref, watch } from 'vue';
import { useToast } from 'primevue/usetoast';
import { ApiClientError, apiRequest } from '~/utils/api';

const props = defineProps<{
  workId: string;
  authors: { id: string; name: string }[];
}>();

type RelatedWork = {
  work_key: string;
  title: string;
  cover_url: string | null;
  first_publish_year?: number | null;
  author_names?: string[];
};

type AuthorProfile = {
  id: string;
  name: string;
  bio: string | null;
  photo_url: string | null;
  openlibrary_author_key: string;
  works: {
    work_key: string;
    title: string;
    cover_url: string | null;
    first_publish_year?: number | null;
  }[];
};

const toast = useToast();
const relatedBooks = ref<RelatedWork[]>([]);
const relatedLoading = ref(false);
const authorProfiles = ref<AuthorProfile[]>([]);
const authorLoading = ref(false);
const visibleRelatedBooks = computed(() => relatedBooks.value.filter((item) => !!item.cover_url));
const authorProfilesWithCoverWorks = computed(() =>
  authorProfiles.value
    .map((author) => ({
      ...author,
      works: author.works.filter((work) => !!work.cover_url),
    }))
    .filter((author) => author.works.length),
);

const load = async () => {
  relatedLoading.value = true;
  try {
    const payload = await apiRequest<{ items: RelatedWork[] }>(
      `/api/v1/works/${props.workId}/related`,
    );
    relatedBooks.value = payload.items || [];
  } catch {
    relatedBooks.value = [];
  } finally {
    relatedLoading.value = false;
  }

  if (!props.authors.length) {
    authorProfiles.value = [];
    return;
  }

  authorLoading.value = true;
  try {
    authorProfiles.value = await Promise.all(
      props.authors
        .slice(0, 3)
        .map((author) => apiRequest<AuthorProfile>(`/api/v1/authors/${author.id}`)),
    );
  } catch {
    authorProfiles.value = [];
  } finally {
    authorLoading.value = false;
  }
};

const importAndOpenRelated = async (relatedWorkKey: string) => {
  try {
    const imported = await apiRequest<{ work: { id: string } }>('/api/v1/books/import', {
      method: 'POST',
      body: { work_key: relatedWorkKey },
    });
    await navigateTo(`/books/${imported.work.id}`);
  } catch (err) {
    const msg = err instanceof ApiClientError ? err.message : 'Unable to open related book.';
    toast.add({ severity: 'error', summary: msg, life: 3000 });
  }
};

const relatedAuthorLabel = (item: RelatedWork): string => {
  if (!item.author_names?.length) {
    return 'Unknown author';
  }
  const firstEntry = item.author_names[0]?.trim();
  if (!firstEntry) {
    return 'Unknown author';
  }
  return firstEntry.split(',')[0]?.split(';')[0]?.trim() || 'Unknown author';
};

onMounted(() => {
  void load();
});

watch(
  () => [props.workId, props.authors.map((author) => author.id).join(',')],
  () => {
    void load();
  },
);
</script>
