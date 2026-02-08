<template>
  <PageShell>
    <NuxtLink to="/library" class="text-sm font-medium text-emerald-700 hover:underline">
      Back to library
    </NuxtLink>

    <Card class="shadow-lg" data-test="book-detail-card">
      <template #title>
        <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div class="flex items-center gap-3">
            <i class="pi pi-book text-emerald-600" aria-hidden="true"></i>
            <span class="text-2xl font-semibold">
              {{ work?.title || 'Book detail' }}
            </span>
          </div>
          <span
            v-if="libraryItem"
            class="rounded bg-slate-100 px-2 py-1 text-xs uppercase text-slate-600"
          >
            {{ libraryItem.status }}
          </span>
        </div>
      </template>
      <template #content>
        <div class="flex flex-col gap-6">
          <InlineAlert v-if="error" tone="error" :message="error" data-test="book-detail-error" />

          <div v-if="coreLoading" class="text-sm text-slate-600">Loading...</div>

          <div v-else class="grid gap-6 md:grid-cols-[160px_1fr]">
            <div class="flex flex-col gap-3">
              <img
                v-if="work?.cover_url"
                :src="work.cover_url"
                alt=""
                class="h-56 w-40 rounded-md border border-slate-200/70 object-cover shadow-sm"
              />
              <div
                v-else
                class="flex h-56 w-40 items-center justify-center rounded-md bg-slate-100"
              >
                <span class="text-xs text-slate-500">No cover</span>
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
              <p v-if="work?.authors?.length" class="text-sm text-slate-700">
                <span class="font-medium">Authors:</span>
                {{ work.authors.map((a) => a.name).join(', ') }}
              </p>
              <p v-if="work?.description" class="text-sm text-slate-700">
                {{ work.description }}
              </p>

              <div v-if="!libraryItem" class="flex flex-col gap-2">
                <p class="text-sm text-slate-600">This book is not in your library yet.</p>
                <NuxtLink
                  to="/books/search"
                  class="text-sm font-medium text-emerald-700 hover:underline"
                >
                  Search and import it
                </NuxtLink>
              </div>
            </div>
          </div>
        </div>
      </template>
    </Card>

    <Card v-if="libraryItem" class="shadow-sm">
      <template #title>
        <div class="flex items-center gap-3 text-lg font-semibold">
          <i class="pi pi-clock text-emerald-600" aria-hidden="true"></i>
          <span>Reading sessions</span>
        </div>
      </template>
      <template #content>
        <div class="flex flex-col gap-4">
          <div v-if="sessionsError" class="flex flex-col gap-2">
            <InlineAlert tone="error" :message="sessionsError" />
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
          <div v-else-if="sessionsLoading" class="text-sm text-slate-600">Loading sessions...</div>

          <div class="grid gap-3 md:grid-cols-3">
            <InputText v-model="sessionPagesRead" placeholder="Pages read" />
            <InputText v-model="sessionProgressPercent" placeholder="Progress % (0-100)" />
            <Button
              label="Log session"
              :loading="savingSession"
              data-test="log-session"
              @click="logSession"
            />
          </div>
          <Textarea v-model="sessionNote" rows="2" auto-resize placeholder="Session note" />

          <div v-if="sessions.length" class="grid gap-2">
            <div
              v-for="s in sessions"
              :key="s.id"
              class="rounded-md border border-slate-200/70 bg-white px-3 py-2"
            >
              <p class="text-sm font-medium text-slate-900">
                {{ formatDate(s.started_at) }}
              </p>
              <p class="text-xs text-slate-600">
                Pages: {{ s.pages_read ?? '-' }} | Progress: {{ s.progress_percent ?? '-' }}
              </p>
              <p v-if="s.note" class="text-xs text-slate-600">{{ s.note }}</p>
            </div>
          </div>
          <p v-else class="text-sm text-slate-600">No sessions yet.</p>
        </div>
      </template>
    </Card>

    <Card v-if="libraryItem" class="shadow-sm">
      <template #title>
        <div class="flex items-center gap-3 text-lg font-semibold">
          <i class="pi pi-pencil text-emerald-600" aria-hidden="true"></i>
          <span>Notes</span>
        </div>
      </template>
      <template #content>
        <div class="flex flex-col gap-4">
          <div v-if="notesError" class="flex flex-col gap-2">
            <InlineAlert tone="error" :message="notesError" />
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
          <div v-else-if="notesLoading" class="text-sm text-slate-600">Loading notes...</div>

          <div class="grid gap-3 md:grid-cols-3">
            <InputText v-model="newNoteTitle" placeholder="Title (optional)" />
            <Select
              v-model="newNoteVisibility"
              :options="visibilityOptions"
              option-label="label"
              option-value="value"
            />
            <Button label="Add note" :loading="savingNote" @click="addNote" />
          </div>
          <Textarea v-model="newNoteBody" rows="3" auto-resize placeholder="Write a note..." />

          <div v-if="notes.length" class="grid gap-2">
            <div
              v-for="n in notes"
              :key="n.id"
              class="rounded-md border border-slate-200/70 bg-white px-3 py-2"
            >
              <div class="flex items-start justify-between gap-3">
                <div>
                  <p v-if="n.title" class="text-sm font-semibold text-slate-900">
                    {{ n.title }}
                  </p>
                  <p class="text-xs text-slate-500">
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
              <p class="mt-2 text-sm text-slate-700">{{ n.body }}</p>
            </div>
          </div>
          <p v-else class="text-sm text-slate-600">No notes yet.</p>
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
          <Button label="Cancel" severity="secondary" text @click="editNoteVisible = false" />
          <Button label="Save" :loading="savingNote" @click="saveEditNote" />
        </div>
      </div>
    </Dialog>

    <Card v-if="libraryItem" class="shadow-sm">
      <template #title>
        <div class="flex items-center gap-3 text-lg font-semibold">
          <i class="pi pi-quote-right text-emerald-600" aria-hidden="true"></i>
          <span>Highlights</span>
        </div>
      </template>
      <template #content>
        <div class="flex flex-col gap-4">
          <div v-if="highlightsError" class="flex flex-col gap-2">
            <InlineAlert tone="error" :message="highlightsError" />
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
          <div v-else-if="highlightsLoading" class="text-sm text-slate-600">
            Loading highlights...
          </div>

          <div class="grid gap-3 md:grid-cols-3">
            <Select
              v-model="newHighlightVisibility"
              :options="visibilityOptions"
              option-label="label"
              option-value="value"
            />
            <InputText v-model="highlightLocationSort" placeholder="Location (optional)" />
            <Button label="Add highlight" :loading="savingHighlight" @click="addHighlight" />
          </div>
          <Textarea
            v-model="newHighlightQuote"
            rows="3"
            auto-resize
            placeholder="Paste a short excerpt..."
          />

          <div v-if="highlights.length" class="grid gap-2">
            <div
              v-for="h in highlights"
              :key="h.id"
              class="rounded-md border border-slate-200/70 bg-white px-3 py-2"
            >
              <div class="flex items-start justify-between gap-3">
                <div>
                  <p class="text-xs text-slate-500">
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
              <p class="mt-2 text-sm text-slate-700">{{ h.quote }}</p>
            </div>
          </div>
          <p v-else class="text-sm text-slate-600">No highlights yet.</p>
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
          <Button label="Cancel" severity="secondary" text @click="editHighlightVisible = false" />
          <Button label="Save" :loading="savingHighlight" @click="saveEditHighlight" />
        </div>
      </div>
    </Dialog>

    <Dialog
      v-model:visible="coverDialogVisible"
      modal
      header="Set cover"
      :style="{ width: '44rem' }"
    >
      <div class="flex flex-col gap-4">
        <p v-if="coverError" class="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {{ coverError }}
        </p>

        <div v-if="needsEditionSelection" class="grid gap-3 md:grid-cols-2">
          <Select
            v-model="selectedEditionId"
            :options="editionOptions"
            option-label="label"
            option-value="value"
            :disabled="editionsLoading"
          />
          <div class="flex items-center gap-2">
            <input id="preferred" v-model="setPreferredEdition" type="checkbox" />
            <label class="text-sm text-slate-700" for="preferred">Set as preferred edition</label>
          </div>
        </div>
        <div v-else class="text-xs text-slate-500">Using your preferred edition for this book.</div>

        <div class="flex flex-wrap gap-2">
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

        <div v-if="coverMode === 'upload'" class="flex flex-col gap-3">
          <input type="file" accept="image/*" @change="onCoverFileChange" />
          <div class="flex justify-end gap-2">
            <Button label="Cancel" severity="secondary" text @click="coverDialogVisible = false" />
            <Button label="Upload" :loading="coverBusy" @click="uploadCover" />
          </div>
        </div>

        <div v-else class="flex flex-col gap-3">
          <InputText v-model="coverSourceUrl" placeholder="https://covers.openlibrary.org/..." />
          <div class="flex justify-end gap-2">
            <Button label="Cancel" severity="secondary" text @click="coverDialogVisible = false" />
            <Button label="Cache from URL" :loading="coverBusy" @click="cacheCover" />
          </div>
        </div>
      </div>
    </Dialog>

    <Card v-if="libraryItem" class="shadow-sm">
      <template #title>
        <div class="flex items-center gap-3 text-lg font-semibold">
          <i class="pi pi-star text-emerald-600" aria-hidden="true"></i>
          <span>Your review</span>
        </div>
      </template>
      <template #content>
        <div class="flex flex-col gap-4">
          <div v-if="reviewError" class="flex flex-col gap-2">
            <InlineAlert tone="error" :message="reviewError" />
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
          <div v-else-if="reviewLoading" class="text-sm text-slate-600">Loading review...</div>

          <div class="grid gap-3 md:grid-cols-3">
            <Select
              v-model="reviewVisibility"
              :options="visibilityOptions"
              option-label="label"
              option-value="value"
            />
            <Select
              v-model="reviewRating"
              :options="ratingOptions"
              option-label="label"
              option-value="value"
            />
            <Button label="Save review" :loading="savingReview" @click="saveReview" />
          </div>
          <InputText v-model="reviewTitle" placeholder="Title (optional)" />
          <Textarea v-model="reviewBody" rows="5" auto-resize placeholder="Write your review..." />
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
import Dialog from 'primevue/dialog';
import InputText from 'primevue/inputtext';
import Select from 'primevue/select';
import Textarea from 'primevue/textarea';
import { ApiClientError, apiRequest } from '~/utils/api';
import InlineAlert from '~/components/InlineAlert.vue';
import PageShell from '~/components/PageShell.vue';

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
const coverMode = ref<'upload' | 'url'>('upload');
const coverBusy = ref(false);
const coverError = ref('');
const coverFile = ref<File | null>(null);
const coverSourceUrl = ref('');
const editionsLoading = ref(false);
const editions = ref<any[]>([]);
const selectedEditionId = ref<string>('');
const setPreferredEdition = ref(true);

const runId = ref(0);

const needsEditionSelection = computed(
  () => Boolean(libraryItem.value) && !libraryItem.value?.preferred_edition_id,
);

const effectiveEditionId = computed(() => {
  const preferred = libraryItem.value?.preferred_edition_id;
  if (preferred) return preferred;
  return selectedEditionId.value;
});

const editionOptions = computed<EditionOption[]>(() =>
  editions.value.map((e: any) => {
    const meta = [
      e.isbn13 || e.isbn10 ? `ISBN: ${e.isbn13 || e.isbn10}` : null,
      e.publisher ? `Publisher: ${e.publisher}` : null,
      e.publish_date ? `Published: ${e.publish_date}` : null,
    ]
      .filter(Boolean)
      .join(' | ');
    return { value: e.id, label: meta ? `${e.id} (${meta})` : e.id };
  }),
);

const visibilityOptions = [
  { label: 'Private', value: 'private' },
  { label: 'Unlisted', value: 'unlisted' },
  { label: 'Public', value: 'public' },
];

const ratingOptions = [
  { label: 'No rating', value: null },
  { label: '1', value: 1 },
  { label: '2', value: 2 },
  { label: '3', value: 3 },
  { label: '4', value: 4 },
  { label: '5', value: 5 },
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
  coverMode.value = 'upload';
  coverFile.value = null;
  coverSourceUrl.value = '';

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

  coverDialogVisible.value = true;
};

const onCoverFileChange = (evt: Event) => {
  const input = evt.target as HTMLInputElement;
  const file = input.files?.[0] || null;
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
    work.value = await apiRequest<WorkDetail>(`/api/v1/works/${workId.value}`);
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
    work.value = await apiRequest<WorkDetail>(`/api/v1/works/${workId.value}`);
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
