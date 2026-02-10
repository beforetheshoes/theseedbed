<template>
  <div class="flex flex-col gap-4">
    <!-- Hero card -->
    <Card data-test="book-detail-card">
      <template #title>
        <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div class="flex items-center gap-3">
            <i class="pi pi-book text-primary" aria-hidden="true"></i>
            <span class="font-serif text-2xl font-semibold tracking-tight">
              {{ work?.title || 'Book detail' }}
            </span>
          </div>
          <Tag
            v-if="libraryItem"
            :value="libraryStatusLabel(libraryItem.status)"
            severity="secondary"
          />
        </div>
      </template>
      <template #content>
        <div class="flex flex-col gap-6">
          <Message v-if="error" severity="error" :closable="false" data-test="book-detail-error">{{
            error
          }}</Message>

          <!-- Skeleton loading for hero -->
          <div v-if="coreLoading" class="grid gap-6 md:grid-cols-[176px_1fr]">
            <Skeleton width="176px" height="256px" borderRadius="0.75rem" />
            <div class="flex flex-col gap-3 pt-2">
              <Skeleton width="66%" height="1.25rem" />
              <Skeleton width="33%" height="1rem" />
              <Skeleton width="100%" height="5rem" class="mt-2" />
            </div>
          </div>

          <div v-else class="grid gap-6 md:grid-cols-[176px_1fr]">
            <div class="flex flex-col gap-3">
              <div
                class="h-64 w-44 overflow-hidden rounded-xl border border-[var(--p-content-border-color)] bg-black/5 shadow-md dark:bg-white/5"
                data-test="book-detail-cover"
              >
                <Image
                  v-if="effectiveCoverUrl"
                  :src="effectiveCoverUrl"
                  alt=""
                  :preview="false"
                  class="h-full w-full"
                  image-class="h-full w-full object-cover"
                  data-test="book-detail-cover-image"
                />
                <CoverPlaceholder v-else data-test="book-detail-cover-placeholder" />
              </div>

              <div v-if="libraryItem" class="flex flex-wrap items-center gap-2">
                <Button
                  label="Set cover"
                  size="small"
                  severity="secondary"
                  data-test="set-cover"
                  @click="openCoverDialog"
                />
              </div>
            </div>

            <div class="flex flex-col gap-3">
              <p v-if="work?.authors?.length" class="text-sm">
                <span class="font-medium">Authors:</span>
                {{ work.authors.map((a) => a.name).join(', ') }}
              </p>
              <p v-if="work?.description" class="prose prose-sm max-w-none dark:prose-invert">
                {{ work.description }}
              </p>

              <div v-if="!libraryItem" class="flex flex-col gap-2">
                <p class="text-sm text-[var(--p-text-muted-color)]">
                  This book is not in your library yet.
                </p>
                <p class="text-sm text-[var(--p-text-muted-color)]">
                  Use the search bar in the top navigation to import and add it.
                </p>
              </div>
            </div>
          </div>
        </div>
      </template>
    </Card>

    <!-- Reading sessions -->
    <Card v-if="libraryItem">
      <template #title>
        <div class="flex items-center gap-3">
          <Avatar icon="pi pi-clock" shape="circle" aria-hidden="true" />
          <span class="font-serif text-lg font-semibold tracking-tight">Reading sessions</span>
        </div>
      </template>
      <template #content>
        <div class="flex flex-col gap-4">
          <div v-if="sessionsError" class="flex flex-col gap-2">
            <Message severity="error" :closable="false">{{ sessionsError }}</Message>
            <div>
              <Button
                label="Retry"
                size="small"
                severity="secondary"
                data-test="sessions-retry"
                @click="loadSessions"
              />
            </div>
          </div>
          <!-- Skeleton loading -->
          <div v-else-if="sessionsLoading" class="flex flex-col gap-2">
            <div v-for="n in 3" :key="n" class="flex items-center gap-3">
              <Skeleton shape="circle" size="0.75rem" class="shrink-0" />
              <div class="flex-1">
                <Skeleton width="33%" height="1rem" class="mb-1" />
                <Skeleton width="50%" height="0.75rem" />
              </div>
            </div>
          </div>

          <div class="grid gap-3 sm:grid-cols-2">
            <InputText v-model="sessionPagesRead" placeholder="Pages read" />
            <InputText v-model="sessionProgressPercent" placeholder="Progress % (0-100)" />
          </div>
          <Textarea v-model="sessionNote" rows="2" auto-resize placeholder="Session note" />
          <div>
            <Button
              label="Log session"
              :loading="savingSession"
              data-test="log-session"
              @click="logSession"
            />
          </div>

          <Timeline v-if="sessions.length" :value="sessions" align="left">
            <template #marker>
              <Avatar shape="circle" size="small" aria-hidden="true" />
            </template>
            <template #content="{ item }">
              <p class="text-sm font-medium">{{ formatDate(item.started_at) }}</p>
              <p class="text-xs text-[var(--p-text-muted-color)]">
                Pages: {{ item.pages_read ?? '-' }} | Progress: {{ item.progress_percent ?? '-' }}
              </p>
              <p v-if="item.note" class="text-xs text-[var(--p-text-muted-color)]">
                {{ item.note }}
              </p>
            </template>
          </Timeline>
          <p v-else-if="!sessionsLoading" class="text-sm text-[var(--p-text-muted-color)]">
            No sessions yet.
          </p>
        </div>
      </template>
    </Card>

    <!-- Notes -->
    <Card v-if="libraryItem">
      <template #title>
        <div class="flex items-center gap-3">
          <Avatar icon="pi pi-pencil" shape="circle" aria-hidden="true" />
          <span class="font-serif text-lg font-semibold tracking-tight">Notes</span>
        </div>
      </template>
      <template #content>
        <div class="flex flex-col gap-4">
          <div v-if="notesError" class="flex flex-col gap-2">
            <Message severity="error" :closable="false">{{ notesError }}</Message>
            <div>
              <Button
                label="Retry"
                size="small"
                severity="secondary"
                data-test="notes-retry"
                @click="loadNotes"
              />
            </div>
          </div>
          <div v-else-if="notesLoading" class="flex flex-col gap-2">
            <Card v-for="n in 2" :key="n">
              <template #content>
                <Skeleton width="33%" height="1rem" class="mb-2" />
                <Skeleton width="100%" height="0.75rem" />
              </template>
            </Card>
          </div>

          <div class="grid gap-3 sm:grid-cols-2">
            <InputText v-model="newNoteTitle" placeholder="Title (optional)" />
            <Select
              v-model="newNoteVisibility"
              :options="visibilityOptions"
              option-label="label"
              option-value="value"
            />
          </div>
          <Textarea v-model="newNoteBody" rows="3" auto-resize placeholder="Write a note..." />
          <div>
            <Button label="Add note" :loading="savingNote" @click="addNote" />
          </div>

          <div v-if="notes.length" class="grid gap-2">
            <Card v-for="n in notes" :key="n.id">
              <template #content>
                <div class="flex items-start justify-between gap-3">
                  <div>
                    <p v-if="n.title" class="text-sm font-semibold">
                      {{ n.title }}
                    </p>
                    <p class="text-xs text-[var(--p-text-muted-color)]">
                      {{ n.visibility }} | {{ formatDate(n.created_at) }}
                    </p>
                  </div>
                  <div class="flex items-center gap-2">
                    <Button
                      label="Edit"
                      size="small"
                      text
                      severity="secondary"
                      @click="openEditNote(n)"
                    />
                    <Button
                      label="Delete"
                      size="small"
                      text
                      severity="danger"
                      :loading="deletingNoteId === n.id"
                      @click="deleteNote(n)"
                    />
                  </div>
                </div>
                <p class="mt-2 text-sm">{{ n.body }}</p>
              </template>
            </Card>
          </div>
          <p v-else-if="!notesLoading" class="text-sm text-[var(--p-text-muted-color)]">
            No notes yet.
          </p>
        </div>
      </template>
    </Card>

    <Dialog v-model:visible="editNoteVisible" modal header="Edit note" :style="{ width: '36rem' }">
      <div class="flex flex-col gap-3">
        <InputText v-model="editNoteTitle" placeholder="Title (optional)" />
        <Select
          v-model="editNoteVisibility"
          :options="visibilityOptions"
          option-label="label"
          option-value="value"
        />
        <Textarea v-model="editNoteBody" rows="6" auto-resize />
        <div class="flex justify-end gap-2">
          <Button
            label="Cancel"
            severity="secondary"
            variant="text"
            @click="editNoteVisible = false"
          />
          <Button label="Save" :loading="savingNote" @click="saveEditNote" />
        </div>
      </div>
    </Dialog>

    <!-- Highlights -->
    <Card v-if="libraryItem">
      <template #title>
        <div class="flex items-center gap-3">
          <Avatar icon="pi pi-quote-right" shape="circle" aria-hidden="true" />
          <span class="font-serif text-lg font-semibold tracking-tight">Highlights</span>
        </div>
      </template>
      <template #content>
        <div class="flex flex-col gap-4">
          <div v-if="highlightsError" class="flex flex-col gap-2">
            <Message severity="error" :closable="false">{{ highlightsError }}</Message>
            <div>
              <Button
                label="Retry"
                size="small"
                severity="secondary"
                data-test="highlights-retry"
                @click="loadHighlights"
              />
            </div>
          </div>
          <div v-else-if="highlightsLoading" class="flex flex-col gap-2">
            <Card v-for="n in 2" :key="n">
              <template #content>
                <Skeleton width="25%" height="0.75rem" class="mb-2" />
                <Skeleton width="100%" height="1rem" />
              </template>
            </Card>
          </div>

          <div class="grid gap-3 sm:grid-cols-2">
            <Select
              v-model="newHighlightVisibility"
              :options="visibilityOptions"
              option-label="label"
              option-value="value"
            />
            <InputText v-model="highlightLocationSort" placeholder="Location (optional)" />
          </div>
          <Textarea
            v-model="newHighlightQuote"
            rows="3"
            auto-resize
            placeholder="Paste a short excerpt..."
          />
          <div>
            <Button label="Add highlight" :loading="savingHighlight" @click="addHighlight" />
          </div>

          <div v-if="highlights.length" class="grid gap-2">
            <Card v-for="h in highlights" :key="h.id">
              <template #content>
                <div class="flex items-start justify-between gap-3">
                  <div>
                    <p class="text-xs text-[var(--p-text-muted-color)]">
                      {{ h.visibility }} | {{ formatDate(h.created_at) }}
                    </p>
                  </div>
                  <div class="flex items-center gap-2">
                    <Button
                      label="Edit"
                      size="small"
                      text
                      severity="secondary"
                      @click="openEditHighlight(h)"
                    />
                    <Button
                      label="Delete"
                      size="small"
                      text
                      severity="danger"
                      :loading="deletingHighlightId === h.id"
                      @click="deleteHighlight(h)"
                    />
                  </div>
                </div>
                <p class="mt-2 text-sm italic">{{ h.quote }}</p>
              </template>
            </Card>
          </div>
          <p v-else-if="!highlightsLoading" class="text-sm text-[var(--p-text-muted-color)]">
            No highlights yet.
          </p>
        </div>
      </template>
    </Card>

    <Dialog
      v-model:visible="editHighlightVisible"
      modal
      header="Edit highlight"
      :style="{ width: '36rem' }"
    >
      <div class="flex flex-col gap-3">
        <Select
          v-model="editHighlightVisibility"
          :options="visibilityOptions"
          option-label="label"
          option-value="value"
        />
        <InputText v-model="editHighlightLocationSort" placeholder="Location (optional)" />
        <Textarea v-model="editHighlightQuote" rows="6" auto-resize />
        <div class="flex justify-end gap-2">
          <Button
            label="Cancel"
            severity="secondary"
            variant="text"
            @click="editHighlightVisible = false"
          />
          <Button label="Save" :loading="savingHighlight" @click="saveEditHighlight" />
        </div>
      </div>
    </Dialog>

    <!-- Cover dialog -->
    <Dialog
      v-model:visible="coverDialogVisible"
      modal
      header="Set cover"
      :style="{ width: '44rem' }"
    >
      <div class="flex flex-col gap-4">
        <Message v-if="coverError" severity="error" :closable="false">{{ coverError }}</Message>

        <div
          v-if="coverMode !== 'choose' && needsEditionSelection"
          class="grid gap-3 sm:grid-cols-2"
        >
          <Select
            v-model="selectedEditionId"
            :options="editionOptions"
            option-label="label"
            option-value="value"
            :disabled="editionsLoading"
          />
          <div class="flex items-center gap-2">
            <Checkbox inputId="preferred" v-model="setPreferredEdition" binary />
            <label class="text-sm" for="preferred">Set as preferred edition</label>
          </div>
        </div>
        <div v-else-if="coverMode !== 'choose'" class="text-xs text-[var(--p-text-muted-color)]">
          Using your preferred edition for this book.
        </div>
        <div v-else class="text-xs text-[var(--p-text-muted-color)]">
          Covers are selected for the work, not a specific edition.
        </div>

        <div class="flex flex-wrap gap-2">
          <Button
            label="Choose from Open Library"
            size="small"
            :severity="coverMode === 'choose' ? 'primary' : 'secondary'"
            @click="coverMode = 'choose'"
          />
          <Button
            label="Upload image"
            size="small"
            :severity="coverMode === 'upload' ? 'primary' : 'secondary'"
            @click="coverMode = 'upload'"
          />
          <Button
            label="Use image URL"
            size="small"
            :severity="coverMode === 'url' ? 'primary' : 'secondary'"
            @click="coverMode = 'url'"
          />
        </div>

        <div v-if="coverMode === 'choose'" class="flex flex-col gap-3">
          <div class="flex items-center justify-between gap-3">
            <p class="text-xs text-[var(--p-text-muted-color)]">
              Select a cover from Open Library.
            </p>
            <Button
              label="Refresh"
              size="small"
              severity="secondary"
              variant="text"
              :loading="coverCandidatesLoading"
              @click="loadCoverCandidates"
            />
          </div>

          <div v-if="coverCandidatesLoading" class="grid grid-cols-3 gap-3 sm:grid-cols-4">
            <Skeleton v-for="n in 8" :key="n" height="120px" borderRadius="0.75rem" />
          </div>

          <div
            v-else-if="coverCandidates.length"
            class="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6"
            data-test="cover-candidates"
          >
            <button
              v-for="c in coverCandidates"
              :key="c.cover_id"
              type="button"
              class="group overflow-hidden rounded-xl border border-[var(--p-content-border-color)] bg-black/5 shadow-sm transition hover:shadow-md dark:bg-white/5"
              :class="coverSelectingId === c.cover_id ? 'opacity-60' : ''"
              :disabled="coverBusy"
              :data-test="`cover-candidate-${c.cover_id}`"
              @click="selectCoverCandidate(c.cover_id)"
            >
              <Image
                :src="c.thumbnail_url"
                alt=""
                :preview="false"
                class="h-[120px] w-full"
                image-class="h-full w-full object-cover"
              />
            </button>
          </div>
          <p v-else class="text-sm text-[var(--p-text-muted-color)]">
            No covers found for this work.
          </p>

          <div class="flex justify-end gap-2">
            <Button
              label="Close"
              severity="secondary"
              variant="text"
              @click="coverDialogVisible = false"
            />
          </div>
        </div>

        <div v-else-if="coverMode === 'upload'" class="flex flex-col gap-3">
          <div class="flex flex-col gap-2">
            <FileUpload
              mode="basic"
              name="cover"
              accept="image/*"
              :auto="false"
              :multiple="false"
              chooseLabel="Choose image"
              @select="onCoverFileSelect"
            />
            <p v-if="coverFile" class="text-xs text-[var(--p-text-muted-color)]">
              Selected: {{ coverFile.name }}
            </p>
          </div>
          <div class="flex justify-end gap-2">
            <Button
              label="Cancel"
              severity="secondary"
              variant="text"
              @click="coverDialogVisible = false"
            />
            <Button label="Upload" :loading="coverBusy" @click="uploadCover" />
          </div>
        </div>

        <div v-else class="flex flex-col gap-3">
          <InputText v-model="coverSourceUrl" placeholder="https://covers.openlibrary.org/..." />
          <div class="flex justify-end gap-2">
            <Button
              label="Cancel"
              severity="secondary"
              variant="text"
              @click="coverDialogVisible = false"
            />
            <Button label="Cache from URL" :loading="coverBusy" @click="cacheCover" />
          </div>
        </div>
      </div>
    </Dialog>

    <!-- Review -->
    <Card v-if="libraryItem">
      <template #title>
        <div class="flex items-center gap-3">
          <Avatar icon="pi pi-star" shape="circle" aria-hidden="true" />
          <span class="font-serif text-lg font-semibold tracking-tight">Your review</span>
        </div>
      </template>
      <template #content>
        <div class="flex flex-col gap-4">
          <div v-if="reviewError" class="flex flex-col gap-2">
            <Message severity="error" :closable="false">{{ reviewError }}</Message>
            <div>
              <Button
                label="Retry"
                size="small"
                severity="secondary"
                data-test="review-retry"
                @click="loadReview"
              />
            </div>
          </div>
          <div v-else-if="reviewLoading" class="flex flex-col gap-3">
            <Skeleton width="33%" height="1.5rem" />
            <Skeleton width="100%" height="1rem" />
          </div>

          <Rating v-model="reviewRating" :stars="5" :cancel="true" />

          <div class="grid gap-3 sm:grid-cols-2">
            <Select
              v-model="reviewVisibility"
              :options="visibilityOptions"
              option-label="label"
              option-value="value"
            />
            <InputText v-model="reviewTitle" placeholder="Title (optional)" />
          </div>
          <Textarea v-model="reviewBody" rows="5" auto-resize placeholder="Write your review..." />
          <div>
            <Button label="Save review" :loading="savingReview" @click="saveReview" />
          </div>
        </div>
      </template>
    </Card>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ layout: 'app', middleware: 'auth' });

import { computed, onMounted, ref, watch } from 'vue';
import { useRoute } from '#imports';
import { ApiClientError, apiRequest } from '~/utils/api';
import { libraryStatusLabel } from '~/utils/libraryStatus';
import CoverPlaceholder from '~/components/CoverPlaceholder.vue';
import type { FileUploadSelectEvent } from 'primevue/fileupload';

type WorkDetail = {
  id: string;
  title: string;
  description: string | null;
  cover_url: string | null;
  authors: { id: string; name: string }[];
};

type LibraryItem = {
  id: string;
  work_id: string;
  preferred_edition_id?: string | null;
  cover_url?: string | null;
  status: string;
  created_at: string;
};

type ReadingSession = {
  id: string;
  started_at: string;
  pages_read: number | null;
  progress_percent: number | null;
  note: string | null;
};

type Note = {
  id: string;
  title: string | null;
  body: string;
  visibility: string;
  created_at: string;
};

type Highlight = {
  id: string;
  quote: string;
  visibility: string;
  location_sort?: number | null;
  created_at: string;
};

const route = useRoute();
const workId = computed(() => String(route.params.workId || ''));

const coreLoading = ref(true);
const error = ref('');

const work = ref<WorkDetail | null>(null);
const libraryItem = ref<LibraryItem | null>(null);
const sessions = ref<ReadingSession[]>([]);
const notes = ref<Note[]>([]);
const highlights = ref<Highlight[]>([]);

const sessionsLoading = ref(false);
const sessionsError = ref('');
const notesLoading = ref(false);
const notesError = ref('');
const highlightsLoading = ref(false);
const highlightsError = ref('');
const reviewLoading = ref(false);
const reviewError = ref('');

const savingSession = ref(false);
const sessionPagesRead = ref('');
const sessionProgressPercent = ref('');
const sessionNote = ref('');

const savingNote = ref(false);
const deletingNoteId = ref<string | null>(null);
const newNoteTitle = ref('');
const newNoteBody = ref('');
const newNoteVisibility = ref<'private' | 'unlisted' | 'public'>('private');

const editNoteVisible = ref(false);
const editNoteId = ref<string | null>(null);
const editNoteTitle = ref('');
const editNoteBody = ref('');
const editNoteVisibility = ref<'private' | 'unlisted' | 'public'>('private');

const savingHighlight = ref(false);
const deletingHighlightId = ref<string | null>(null);
const newHighlightQuote = ref('');
const newHighlightVisibility = ref<'private' | 'unlisted' | 'public'>('private');
const highlightLocationSort = ref('');

const editHighlightVisible = ref(false);
const editHighlightId = ref<string | null>(null);
const editHighlightQuote = ref('');
const editHighlightVisibility = ref<'private' | 'unlisted' | 'public'>('private');
const editHighlightLocationSort = ref('');

const savingReview = ref(false);
const reviewVisibility = ref<'private' | 'unlisted' | 'public'>('private');
const reviewRating = ref<number | null>(null);
const reviewTitle = ref('');
const reviewBody = ref('');

type EditionOption = { label: string; value: string };
const coverDialogVisible = ref(false);
const coverMode = ref<'choose' | 'upload' | 'url'>('choose');
const coverBusy = ref(false);
const coverError = ref('');
const coverFile = ref<File | null>(null);
const coverSourceUrl = ref('');
const editionsLoading = ref(false);
const editions = ref<any[]>([]);
const selectedEditionId = ref<string>('');
const setPreferredEdition = ref(true);
const coverCandidatesLoading = ref(false);
const coverCandidates = ref<{ cover_id: number; thumbnail_url: string; image_url: string }[]>([]);
const coverSelectingId = ref<number | null>(null);

const runId = ref(0);

const needsEditionSelection = computed(
  () => Boolean(libraryItem.value) && !libraryItem.value?.preferred_edition_id,
);

const effectiveCoverUrl = computed(
  () => libraryItem.value?.cover_url ?? work.value?.cover_url ?? null,
);

const effectiveEditionId = computed(() => {
  const preferred = libraryItem.value?.preferred_edition_id;
  if (preferred) return preferred;
  return selectedEditionId.value;
});

const editionOptions = computed<EditionOption[]>(() =>
  editions.value.map((e: any) => {
    const providerLabel =
      typeof e.provider_id === 'string' && e.provider_id.startsWith('/books/')
        ? e.provider_id.replace('/books/', '')
        : typeof e.provider_id === 'string'
          ? e.provider_id
          : null;
    const isbn = e.isbn13 || e.isbn10 || null;
    const meta = [
      e.publisher || null,
      e.publish_date ? `Published ${e.publish_date}` : null,
      isbn ? `ISBN ${isbn}` : null,
      providerLabel ? `Open Library ${providerLabel}` : null,
    ]
      .filter(Boolean)
      .join(' | ');
    return { value: e.id, label: meta || 'Edition' };
  }),
);

const visibilityOptions = [
  { label: 'Private', value: 'private' },
  { label: 'Unlisted', value: 'unlisted' },
  { label: 'Public', value: 'public' },
];

const formatDate = (value: string) => {
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
};

const resetSectionState = () => {
  sessions.value = [];
  notes.value = [];
  highlights.value = [];

  sessionsLoading.value = false;
  sessionsError.value = '';
  notesLoading.value = false;
  notesError.value = '';
  highlightsLoading.value = false;
  highlightsError.value = '';
  reviewLoading.value = false;
  reviewError.value = '';

  reviewTitle.value = '';
  reviewBody.value = '';
  reviewVisibility.value = 'private';
  reviewRating.value = null;
};

const fetchCore = async (id: number) => {
  coreLoading.value = true;
  error.value = '';
  try {
    resetSectionState();

    const nextWork = await apiRequest<WorkDetail>(`/api/v1/works/${workId.value}`);
    if (id !== runId.value) return;
    work.value = nextWork;

    try {
      const nextLibraryItem = await apiRequest<LibraryItem>(
        `/api/v1/library/items/by-work/${workId.value}`,
      );
      if (id !== runId.value) return;
      libraryItem.value = nextLibraryItem;
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 404) {
        libraryItem.value = null;
      } else {
        throw err;
      }
    }
  } catch (err) {
    if (err instanceof ApiClientError) {
      error.value = err.message;
    } else {
      error.value = 'Unable to load book details right now.';
    }
  } finally {
    if (id === runId.value) {
      coreLoading.value = false;
    }
  }
};

const loadSessions = async () => {
  if (!libraryItem.value) return;
  const id = runId.value;
  sessionsLoading.value = true;
  sessionsError.value = '';
  try {
    const payload = await apiRequest<{ items: ReadingSession[] }>(
      `/api/v1/library/items/${libraryItem.value.id}/sessions`,
    );
    if (id !== runId.value) return;
    sessions.value = payload.items;
  } catch (err) {
    if (id !== runId.value) return;
    sessionsError.value = err instanceof ApiClientError ? err.message : 'Unable to load sessions.';
  } finally {
    if (id === runId.value) {
      sessionsLoading.value = false;
    }
  }
};

const loadNotes = async () => {
  if (!libraryItem.value) return;
  const id = runId.value;
  notesLoading.value = true;
  notesError.value = '';
  try {
    const payload = await apiRequest<{ items: Note[] }>(
      `/api/v1/library/items/${libraryItem.value.id}/notes`,
    );
    if (id !== runId.value) return;
    notes.value = payload.items;
  } catch (err) {
    if (id !== runId.value) return;
    notesError.value = err instanceof ApiClientError ? err.message : 'Unable to load notes.';
  } finally {
    if (id === runId.value) {
      notesLoading.value = false;
    }
  }
};

const loadHighlights = async () => {
  if (!libraryItem.value) return;
  const id = runId.value;
  highlightsLoading.value = true;
  highlightsError.value = '';
  try {
    const payload = await apiRequest<{ items: Highlight[] }>(
      `/api/v1/library/items/${libraryItem.value.id}/highlights`,
    );
    if (id !== runId.value) return;
    highlights.value = payload.items;
  } catch (err) {
    if (id !== runId.value) return;
    highlightsError.value =
      err instanceof ApiClientError ? err.message : 'Unable to load highlights.';
  } finally {
    if (id === runId.value) {
      highlightsLoading.value = false;
    }
  }
};

const loadReview = async () => {
  if (!libraryItem.value) return;
  const id = runId.value;
  reviewLoading.value = true;
  reviewError.value = '';
  try {
    const myReviews = await apiRequest<{ items: any[] }>('/api/v1/me/reviews');
    if (id !== runId.value) return;
    const existing = myReviews.items.find((r) => r.work_id === workId.value) || null;
    if (existing) {
      reviewTitle.value = existing.title || '';
      reviewBody.value = existing.body || '';
      reviewVisibility.value = existing.visibility;
      reviewRating.value = existing.rating ?? null;
    } else {
      reviewTitle.value = '';
      reviewBody.value = '';
      reviewVisibility.value = 'private';
      reviewRating.value = null;
    }
  } catch (err) {
    if (id !== runId.value) return;
    reviewError.value = err instanceof ApiClientError ? err.message : 'Unable to load review.';
  } finally {
    if (id === runId.value) {
      reviewLoading.value = false;
    }
  }
};

const refresh = async () => {
  runId.value += 1;
  const id = runId.value;
  await fetchCore(id);
  if (id !== runId.value) return;
  if (!libraryItem.value) return;

  void loadSessions();
  void loadNotes();
  void loadHighlights();
  void loadReview();
};

const openCoverDialog = async () => {
  coverError.value = '';
  coverBusy.value = false;
  coverMode.value = 'choose';
  coverFile.value = null;
  coverSourceUrl.value = '';
  coverCandidates.value = [];
  coverCandidatesLoading.value = false;
  coverSelectingId.value = null;

  if (needsEditionSelection.value) {
    editionsLoading.value = true;
    try {
      const payload = await apiRequest<{ items: any[] }>(`/api/v1/works/${workId.value}/editions`);
      editions.value = payload.items;
      if (!selectedEditionId.value && payload.items.length) {
        selectedEditionId.value = payload.items[0].id;
      }
    } catch (err) {
      coverError.value = err instanceof ApiClientError ? err.message : 'Unable to load editions.';
    } finally {
      editionsLoading.value = false;
    }
  }

  void loadCoverCandidates();
  coverDialogVisible.value = true;
};

const loadCoverCandidates = async () => {
  coverCandidatesLoading.value = true;
  try {
    const payload = await apiRequest<{ items: any[] }>(`/api/v1/works/${workId.value}/covers`);
    coverCandidates.value = payload.items || [];
  } catch (err) {
    coverCandidates.value = [];
    // Do not override an editions-loading error from openCoverDialog.
    if (!coverError.value) {
      coverError.value =
        err instanceof ApiClientError ? err.message : 'Unable to load cover candidates.';
    }
  } finally {
    coverCandidatesLoading.value = false;
  }
};

const selectCoverCandidate = async (coverId: number) => {
  coverBusy.value = true;
  coverError.value = '';
  coverSelectingId.value = coverId;
  try {
    await apiRequest(`/api/v1/works/${workId.value}/covers/select`, {
      method: 'POST',
      body: { cover_id: coverId },
    });
    coverDialogVisible.value = false;
    await refresh();
  } catch (err) {
    coverError.value = err instanceof ApiClientError ? err.message : 'Unable to set cover.';
  } finally {
    coverBusy.value = false;
    coverSelectingId.value = null;
  }
};

const onCoverFileSelect = (evt: FileUploadSelectEvent) => {
  const file = (evt.files as File[] | undefined)?.[0] ?? null;
  coverFile.value = file;
};

const maybeSetPreferredEdition = async () => {
  if (!libraryItem.value) return;
  if (!setPreferredEdition.value) return;
  if (!effectiveEditionId.value) return;
  if (libraryItem.value.preferred_edition_id === effectiveEditionId.value) return;

  await apiRequest(`/api/v1/library/items/${libraryItem.value.id}`, {
    method: 'PATCH',
    body: { preferred_edition_id: effectiveEditionId.value },
  });
  libraryItem.value = await apiRequest<LibraryItem>(
    `/api/v1/library/items/by-work/${workId.value}`,
  );
};

const uploadCover = async () => {
  if (!effectiveEditionId.value) {
    coverError.value = 'Select an edition first.';
    return;
  }
  if (!coverFile.value) {
    coverError.value = 'Choose an image file first.';
    return;
  }

  coverBusy.value = true;
  coverError.value = '';
  try {
    const fd = new FormData();
    fd.append('file', coverFile.value);
    await apiRequest(`/api/v1/editions/${effectiveEditionId.value}/cover`, {
      method: 'POST',
      body: fd,
    });
    await maybeSetPreferredEdition();
    await refresh();
    coverDialogVisible.value = false;
  } catch (err) {
    coverError.value = err instanceof ApiClientError ? err.message : 'Unable to set cover.';
  } finally {
    coverBusy.value = false;
  }
};

const cacheCover = async () => {
  if (!effectiveEditionId.value) {
    coverError.value = 'Select an edition first.';
    return;
  }
  if (!coverSourceUrl.value.trim()) {
    coverError.value = 'Enter an image URL first.';
    return;
  }
  coverBusy.value = true;
  coverError.value = '';
  try {
    await apiRequest(`/api/v1/editions/${effectiveEditionId.value}/cover/cache`, {
      method: 'POST',
      body: { source_url: coverSourceUrl.value.trim() },
    });
    await maybeSetPreferredEdition();
    await refresh();
    coverDialogVisible.value = false;
  } catch (err) {
    coverError.value = err instanceof ApiClientError ? err.message : 'Unable to cache cover.';
  } finally {
    coverBusy.value = false;
  }
};

const logSession = async () => {
  if (!libraryItem.value) return;
  savingSession.value = true;
  error.value = '';
  try {
    const pages = sessionPagesRead.value.trim();
    const percent = sessionProgressPercent.value.trim();
    await apiRequest(`/api/v1/library/items/${libraryItem.value.id}/sessions`, {
      method: 'POST',
      body: {
        started_at: new Date().toISOString(),
        pages_read: pages ? Number(pages) : null,
        progress_percent: percent ? Number(percent) : null,
        note: sessionNote.value.trim() || null,
      },
    });
    sessionPagesRead.value = '';
    sessionProgressPercent.value = '';
    sessionNote.value = '';
    await loadSessions();
  } catch (err) {
    error.value = err instanceof ApiClientError ? err.message : 'Unable to log session.';
  } finally {
    savingSession.value = false;
  }
};

const addNote = async () => {
  if (!libraryItem.value) return;
  if (!newNoteBody.value.trim()) return;
  savingNote.value = true;
  error.value = '';
  try {
    await apiRequest(`/api/v1/library/items/${libraryItem.value.id}/notes`, {
      method: 'POST',
      body: {
        title: newNoteTitle.value.trim() || null,
        body: newNoteBody.value,
        visibility: newNoteVisibility.value,
      },
    });
    newNoteTitle.value = '';
    newNoteBody.value = '';
    await loadNotes();
  } catch (err) {
    error.value = err instanceof ApiClientError ? err.message : 'Unable to add note.';
  } finally {
    savingNote.value = false;
  }
};

const openEditNote = (note: Note) => {
  editNoteId.value = note.id;
  editNoteTitle.value = note.title || '';
  editNoteBody.value = note.body;
  editNoteVisibility.value = note.visibility as any;
  editNoteVisible.value = true;
};

const saveEditNote = async () => {
  if (!editNoteId.value) return;
  savingNote.value = true;
  error.value = '';
  try {
    await apiRequest(`/api/v1/notes/${editNoteId.value}`, {
      method: 'PATCH',
      body: {
        title: editNoteTitle.value.trim() || null,
        body: editNoteBody.value,
        visibility: editNoteVisibility.value,
      },
    });
    editNoteVisible.value = false;
    await loadNotes();
  } catch (err) {
    error.value = err instanceof ApiClientError ? err.message : 'Unable to update note.';
  } finally {
    savingNote.value = false;
  }
};

const deleteNote = async (note: Note) => {
  deletingNoteId.value = note.id;
  error.value = '';
  try {
    await apiRequest(`/api/v1/notes/${note.id}`, { method: 'DELETE' });
    notes.value = notes.value.filter((n) => n.id !== note.id);
  } catch (err) {
    error.value = err instanceof ApiClientError ? err.message : 'Unable to delete note.';
  } finally {
    deletingNoteId.value = null;
  }
};

const addHighlight = async () => {
  if (!libraryItem.value) return;
  if (!newHighlightQuote.value.trim()) return;
  savingHighlight.value = true;
  error.value = '';
  try {
    const sort = highlightLocationSort.value.trim();
    await apiRequest(`/api/v1/library/items/${libraryItem.value.id}/highlights`, {
      method: 'POST',
      body: {
        quote: newHighlightQuote.value,
        visibility: newHighlightVisibility.value,
        location_sort: sort ? Number(sort) : null,
      },
    });
    newHighlightQuote.value = '';
    highlightLocationSort.value = '';
    await loadHighlights();
  } catch (err) {
    error.value = err instanceof ApiClientError ? err.message : 'Unable to add highlight.';
  } finally {
    savingHighlight.value = false;
  }
};

const openEditHighlight = (highlight: Highlight) => {
  editHighlightId.value = highlight.id;
  editHighlightQuote.value = highlight.quote;
  editHighlightVisibility.value = highlight.visibility as any;
  editHighlightLocationSort.value =
    highlight.location_sort !== null && highlight.location_sort !== undefined
      ? String(highlight.location_sort)
      : '';
  editHighlightVisible.value = true;
};

const saveEditHighlight = async () => {
  if (!editHighlightId.value) return;
  savingHighlight.value = true;
  error.value = '';
  try {
    const sort = editHighlightLocationSort.value.trim();
    await apiRequest(`/api/v1/highlights/${editHighlightId.value}`, {
      method: 'PATCH',
      body: {
        quote: editHighlightQuote.value,
        visibility: editHighlightVisibility.value,
        location_sort: sort ? Number(sort) : null,
      },
    });
    editHighlightVisible.value = false;
    await loadHighlights();
  } catch (err) {
    error.value = err instanceof ApiClientError ? err.message : 'Unable to update highlight.';
  } finally {
    savingHighlight.value = false;
  }
};

const deleteHighlight = async (highlight: Highlight) => {
  deletingHighlightId.value = highlight.id;
  error.value = '';
  try {
    await apiRequest(`/api/v1/highlights/${highlight.id}`, { method: 'DELETE' });
    highlights.value = highlights.value.filter((h) => h.id !== highlight.id);
  } catch (err) {
    error.value = err instanceof ApiClientError ? err.message : 'Unable to delete highlight.';
  } finally {
    deletingHighlightId.value = null;
  }
};

const saveReview = async () => {
  savingReview.value = true;
  error.value = '';
  try {
    await apiRequest(`/api/v1/works/${workId.value}/review`, {
      method: 'POST',
      body: {
        title: reviewTitle.value.trim() || null,
        body: reviewBody.value,
        rating: reviewRating.value,
        visibility: reviewVisibility.value,
      },
    });
  } catch (err) {
    error.value = err instanceof ApiClientError ? err.message : 'Unable to save review.';
  } finally {
    savingReview.value = false;
  }
};

onMounted(() => {
  void refresh();
});

watch(workId, () => {
  void refresh();
});
</script>
