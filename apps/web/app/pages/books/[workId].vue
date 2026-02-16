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
          <div v-if="libraryItem" class="flex items-center gap-2">
            <Button
              v-if="!statusEditorOpen"
              :label="libraryStatusLabel(libraryItem.status)"
              size="small"
              severity="secondary"
              variant="outlined"
              data-test="book-status-open"
              @click="openStatusEditor"
            />
            <Select
              v-else
              :model-value="statusEditorValue"
              :options="statusOptions"
              option-label="label"
              option-value="value"
              data-test="book-status-select"
              :disabled="statusSaving"
              @update:model-value="onStatusSelected"
            />
          </div>
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
                <Button
                  label="Remove from library"
                  size="small"
                  severity="danger"
                  variant="text"
                  data-test="book-remove-open"
                  @click="openRemoveConfirm"
                />
              </div>
              <div class="flex items-center gap-2">
                <Button
                  label="Enrich metadata"
                  size="small"
                  severity="secondary"
                  data-test="book-enrich-open"
                  :disabled="!work"
                  @click="openEnrichmentDialog"
                />
              </div>
            </div>

            <div class="flex flex-col gap-3">
              <p v-if="work?.authors?.length" class="text-sm">
                <span class="font-medium">Authors:</span>
                {{ work.authors.map((a) => a.name).join(', ') }}
              </p>
              <p v-if="identifierSummary.length" class="text-sm">
                <span class="font-medium">Identifiers:</span>
                {{ identifierSummary.join(' | ') }}
              </p>
              <div
                v-if="renderedDescriptionHtml"
                class="prose prose-sm max-w-none dark:prose-invert"
                data-test="book-detail-description"
                v-html="renderedDescriptionHtml"
              />

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
        <div class="flex items-center justify-between gap-3">
          <div class="flex items-center gap-3">
            <Avatar icon="pi pi-clock" shape="circle" aria-hidden="true" />
            <span class="font-serif text-lg font-semibold tracking-tight">Reading sessions</span>
          </div>
          <div v-if="showActiveLogger">
            <Button
              v-if="!showConvertUnitSelect"
              label="Convert progress unit"
              size="small"
              severity="secondary"
              variant="outlined"
              data-test="convert-unit-open"
              @click="openConvertUnitPicker"
            />
            <Select
              v-else
              :model-value="convertUnitSelection"
              :options="convertUnitOptions"
              option-label="label"
              option-value="value"
              option-disabled="disabled"
              data-test="convert-unit-select"
              @update:model-value="onConvertUnitChange"
            />
          </div>
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

          <template v-if="showActiveLogger">
            <div
              class="rounded-xl border border-[var(--p-content-border-color)] p-4"
              data-test="progress-summary"
            >
              <div class="mx-auto flex w-[300px] max-w-full flex-col items-center gap-4">
                <div class="relative h-[210px] w-[210px]">
                  <Knob
                    :model-value="currentCanonicalPercent"
                    :min="0"
                    :max="100"
                    :readonly="true"
                    :size="210"
                    :show-value="false"
                    :stroke-width="14"
                  />
                  <div class="absolute inset-0 flex items-center justify-center">
                    <InputText
                      v-if="editingKnobValue"
                      v-model="knobEditValue"
                      class="w-[84px] text-center"
                      data-test="knob-value-input"
                      @blur="commitKnobValueEdit"
                      @keydown.enter.prevent="commitKnobValueEdit"
                      @keydown.esc.prevent="cancelKnobValueEdit"
                    />
                    <span
                      v-else
                      role="button"
                      tabindex="0"
                      class="min-w-[84px] cursor-text px-2 py-1 text-center text-xl font-semibold"
                      data-test="knob-value-display"
                      @click="startKnobValueEdit"
                      @keydown.enter.prevent="startKnobValueEdit"
                    >
                      {{ knobDisplayValue }}
                    </span>
                  </div>
                </div>
                <Slider
                  v-model="sessionProgressValue"
                  class="w-full"
                  :min="0"
                  :max="progressSliderMax"
                  :step="1"
                  :disabled="progressSliderDisabled"
                  data-test="session-progress-slider"
                />
                <p
                  class="text-xs text-[var(--p-text-muted-color)]"
                  data-test="progress-cross-units"
                >
                  Pages: {{ progressPagesDisplay }} • Percentage: {{ progressPercentDisplay }}% •
                  Time: {{ progressTimeDisplay }}
                </p>
                <Tag :value="`${streakDays}-day streak`" severity="info" />
                <div class="flex flex-col items-center gap-1">
                  <label class="text-xs font-medium">Log date</label>
                  <DatePicker
                    v-model="sessionLoggedDate"
                    :max-date="todayDate"
                    show-icon
                    date-format="mm/dd/yy"
                    data-test="session-date"
                  />
                </div>
                <Textarea
                  v-model="sessionNote"
                  rows="5"
                  auto-resize
                  placeholder="Session note"
                  class="w-full max-w-[500px]"
                />
                <Button
                  label="Log session"
                  :loading="savingSession"
                  data-test="log-session"
                  @click="logSession"
                />
              </div>
            </div>

            <div class="flex flex-col items-center gap-0 text-sm" data-test="progress-totals">
              <p class="m-0 font-medium">Totals</p>
              <p class="m-0 text-xs text-[var(--p-text-muted-color)]">
                Pages: {{ totalsPagesDisplay }} • Time: {{ totalsTimeDisplay }}
              </p>
              <button
                v-if="
                  ineligibleConvertUnits.length ||
                  bookStatistics?.data_quality.has_missing_totals ||
                  bookStatistics?.data_quality.unresolved_logs_exist
                "
                type="button"
                class="text-xs text-amber-700 underline underline-offset-2 hover:text-amber-600"
                data-test="missing-totals-warning"
                @click="promptMissingTotalsFromIneligible"
              >
                Some unit conversions need totals. Add missing totals.
              </button>
            </div>
          </template>

          <Card>
            <template #content>
              <div class="flex flex-col gap-2">
                <div class="flex items-center justify-between">
                  <p class="text-sm font-medium">Progress trend</p>
                  <div class="flex items-center gap-2">
                    <Select
                      v-model="progressChartUnit"
                      :options="progressChartUnitOptions"
                      option-label="label"
                      option-value="value"
                      data-test="progress-chart-unit"
                    />
                    <Select
                      v-model="progressChartMode"
                      :options="progressChartModeOptions"
                      option-label="label"
                      option-value="value"
                      data-test="progress-chart-mode"
                    />
                  </div>
                </div>
                <Chart
                  type="line"
                  :data="progressChartData"
                  :options="progressChartOptions"
                  data-test="progress-chart"
                />
              </div>
            </template>
          </Card>

          <Timeline v-if="timelineSessions.length" :value="timelineSessions" align="left">
            <template #marker>
              <Avatar shape="circle" size="small" aria-hidden="true" />
            </template>
            <template #content="{ item }">
              <p class="text-sm font-medium">{{ formatDateOnly(item.logged_at) }}</p>
              <p class="text-xs text-[var(--p-text-muted-color)]">
                Start:
                <span class="font-medium text-slate-500">{{ item.start_display }}</span>
                • End:
                <span class="font-semibold text-sky-700">{{ item.end_display }}</span>
                • This session:
                <span
                  class="font-semibold"
                  :class="
                    item.session_delta > 0
                      ? 'text-emerald-600'
                      : item.session_delta < 0
                        ? 'text-amber-600'
                        : 'text-slate-500'
                  "
                >
                  {{ item.session_display }}
                </span>
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

    <Dialog
      v-model:visible="confirmDecreaseVisible"
      modal
      header="Lower progress?"
      :style="{ width: '28rem' }"
    >
      <div class="flex flex-col gap-3">
        <p class="text-sm">
          You are lowering progress from {{ lastLoggedValue }} to {{ sessionProgressValue }}.
          Continue?
        </p>
        <div class="flex justify-end gap-2">
          <Button
            label="Cancel"
            severity="secondary"
            variant="text"
            data-test="decrease-cancel"
            @click="cancelDecrease"
          />
          <Button label="Continue" data-test="decrease-confirm" @click="confirmDecreaseAndLog" />
        </div>
      </div>
    </Dialog>

    <Dialog
      v-model:visible="showMissingTotalsForm"
      modal
      header="Add missing totals"
      :style="{ width: '32rem' }"
    >
      <div
        v-if="conversionMissing.length"
        class="flex flex-col gap-3"
        data-test="missing-totals-dialog-content"
      >
        <p class="text-sm text-[var(--p-text-muted-color)]">
          Some conversions require missing totals before they can be selected.
        </p>
        <div
          v-if="loadingTotalsSuggestions"
          class="flex items-center gap-2 text-xs text-[var(--p-text-muted-color)]"
          data-test="missing-totals-suggestions-loading"
        >
          <i class="pi pi-spin pi-spinner" aria-hidden="true"></i>
          <span>Loading suggestions...</span>
        </div>
        <div class="grid gap-3">
          <div v-if="conversionMissing.includes('total_pages')" class="flex flex-col gap-1">
            <label class="text-xs font-medium">Total pages</label>
            <InputText
              v-model="pendingTotalPages"
              placeholder="Enter pages"
              data-test="pending-total-pages"
            />
            <p v-if="totalPageSuggestions.length" class="text-xs text-[var(--p-text-muted-color)]">
              Suggestion: {{ totalPageSuggestions[0] }} pages
            </p>
          </div>
          <div v-if="conversionMissing.includes('total_audio_minutes')" class="flex flex-col gap-1">
            <label class="text-xs font-medium">Total time (hh:mm:ss)</label>
            <InputText
              v-model="pendingTotalAudioMinutes"
              placeholder="Enter time"
              data-test="pending-total-audio-minutes"
            />
            <p v-if="totalTimeSuggestions.length" class="text-xs text-[var(--p-text-muted-color)]">
              Suggestion: {{ minutesToHms(totalTimeSuggestions[0]) }}
            </p>
          </div>
        </div>
        <div class="flex justify-end">
          <Button
            label="Save totals"
            size="small"
            :loading="savingTotals"
            data-test="save-missing-totals"
            @click="saveMissingTotals"
          />
        </div>
      </div>
    </Dialog>

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
              :model-value="newNoteVisibility"
              @update:modelValue="updateNewNoteVisibility"
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
          :model-value="editNoteVisibility"
          @update:modelValue="updateEditNoteVisibility"
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
              :model-value="newHighlightVisibility"
              @update:modelValue="updateNewHighlightVisibility"
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
            label="Choose from Search"
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
              Select a cover from available sources.
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
              :key="coverCandidateKey(c)"
              type="button"
              class="group overflow-hidden rounded-xl border border-[var(--p-content-border-color)] bg-black/5 shadow-sm transition hover:shadow-md dark:bg-white/5"
              :class="coverSelectingKey === coverCandidateKey(c) ? 'opacity-60' : ''"
              :disabled="coverBusy"
              :data-test="`cover-candidate-${coverCandidateKey(c)}`"
              @click="selectCoverCandidate(c)"
            >
              <Image
                :src="c.thumbnail_url"
                alt=""
                :preview="false"
                class="h-[120px] w-full"
                image-class="h-full w-full object-cover"
              />
              <div class="px-2 py-1 text-left text-[11px] text-[var(--p-text-muted-color)]">
                {{ c.source === 'googlebooks' ? 'Google Books' : 'Open Library' }}
              </div>
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

    <!-- Remove-from-library dialog -->
    <Dialog
      v-model:visible="enrichDialogVisible"
      modal
      header="Enrich metadata"
      :style="{ width: '52rem' }"
    >
      <div class="flex flex-col gap-4">
        <Message v-if="enrichError" severity="error" :closable="false">{{ enrichError }}</Message>
        <Message
          v-for="warning in enrichProviderWarnings"
          :key="warning"
          severity="warn"
          :closable="false"
          >{{ warning }}</Message
        >

        <div class="flex flex-wrap items-center gap-2">
          <Button
            label="Pick all Open Library"
            size="small"
            severity="secondary"
            data-test="book-enrich-pick-openlibrary"
            :disabled="enrichLoading || enrichApplying || !canPickProvider('openlibrary')"
            @click="pickAllFromProvider('openlibrary')"
          />
          <Button
            label="Pick all Google Books"
            size="small"
            severity="secondary"
            data-test="book-enrich-pick-googlebooks"
            :disabled="enrichLoading || enrichApplying || !canPickProvider('googlebooks')"
            @click="pickAllFromProvider('googlebooks')"
          />
          <Button
            label="Reset all to current"
            size="small"
            severity="secondary"
            variant="text"
            data-test="book-enrich-reset"
            :disabled="enrichLoading || enrichApplying"
            @click="resetAllToCurrent"
          />
          <Button
            label="Refresh"
            size="small"
            severity="secondary"
            variant="text"
            :disabled="enrichApplying"
            :loading="enrichLoading"
            @click="loadEnrichmentCandidates"
          />
        </div>

        <p v-if="enrichEditionTarget" class="text-xs text-[var(--p-text-muted-color)]">
          Edition target: {{ enrichEditionTarget.label }}
        </p>

        <div v-if="enrichLoading" class="flex flex-col gap-2">
          <Skeleton v-for="n in 6" :key="n" width="100%" height="2rem" />
        </div>

        <div v-else class="flex max-h-[55vh] flex-col gap-3 overflow-auto pr-1">
          <div
            class="hidden gap-3 border-b border-[var(--p-content-border-color)] px-2 pb-2 text-xs font-semibold uppercase tracking-wide text-[var(--p-text-muted-color)] md:grid md:grid-cols-[180px_1fr_1fr_1fr]"
          >
            <p>Field</p>
            <p>Current</p>
            <p>Open Library</p>
            <p>Google Books</p>
          </div>
          <Card
            v-for="row in enrichRows"
            :key="row.fieldKey"
            :data-test="`book-enrich-field-${row.fieldKey}`"
          >
            <template #content>
              <div class="grid gap-3 md:grid-cols-[180px_1fr_1fr_1fr]">
                <div class="md:pt-2">
                  <div class="flex items-center justify-between gap-2 md:block">
                    <p class="text-sm font-medium">{{ row.label }}</p>
                    <Tag
                      v-if="row.hasConflict"
                      value="Conflict"
                      severity="warning"
                      data-test="book-enrich-conflict"
                    />
                  </div>
                </div>

                <label
                  class="flex cursor-pointer flex-col gap-2 rounded border p-3 transition"
                  :class="
                    enrichSelectionByField[row.fieldKey] === 'keep'
                      ? 'border-primary bg-primary/5'
                      : 'border-[var(--p-content-border-color)]'
                  "
                  :data-test="`book-enrich-cell-${row.fieldKey}-current`"
                >
                  <span class="inline-flex items-center gap-2 text-sm font-medium">
                    <input
                      type="radio"
                      :checked="enrichSelectionByField[row.fieldKey] === 'keep'"
                      @change="setEnrichmentSelection(row.fieldKey, 'keep')"
                      :name="`pick-${row.fieldKey}`"
                      value="keep"
                      class="h-4 w-4"
                    />
                    Current
                  </span>
                  <div v-if="row.fieldKey === 'work.cover_url'" class="mt-1">
                    <div
                      class="overflow-hidden rounded border border-[var(--p-content-border-color)]"
                    >
                      <Image
                        v-if="toEnrichmentImageUrl(row.currentValue)"
                        :src="toEnrichmentImageUrl(row.currentValue) || ''"
                        alt=""
                        :preview="false"
                        class="h-36 w-full bg-black/5"
                        image-class="h-full w-full object-contain"
                      />
                      <div
                        v-else
                        class="flex h-36 items-center justify-center bg-[var(--p-surface-100)] px-2 text-sm text-[var(--p-text-muted-color)] dark:bg-[var(--p-surface-800)]"
                      >
                        No current cover
                      </div>
                    </div>
                    <details
                      v-if="formatEnrichmentValue(row.currentValue)"
                      class="mt-2 text-xs text-[var(--p-text-muted-color)]"
                    >
                      <summary class="cursor-pointer select-none">Show raw URL</summary>
                      <p class="mt-2 break-all">
                        {{ formatEnrichmentValue(row.currentValue) }}
                      </p>
                    </details>
                  </div>
                  <p v-else class="whitespace-pre-wrap break-words text-sm">
                    {{ formatEnrichmentValue(row.currentValue) || 'None' }}
                  </p>
                </label>

                <label
                  class="flex flex-col gap-2 rounded border p-3 transition"
                  :class="
                    !row.byProvider.openlibrary
                      ? 'cursor-not-allowed opacity-60'
                      : enrichSelectionByField[row.fieldKey] === 'openlibrary'
                        ? 'cursor-pointer border-primary bg-primary/5'
                        : 'cursor-pointer border-[var(--p-content-border-color)]'
                  "
                  :data-test="`book-enrich-cell-${row.fieldKey}-openlibrary`"
                >
                  <span class="inline-flex items-center gap-2 text-sm font-medium">
                    <input
                      type="radio"
                      v-model="enrichSelectionByField[row.fieldKey]"
                      :name="`pick-${row.fieldKey}`"
                      value="openlibrary"
                      :disabled="!row.byProvider.openlibrary"
                      class="h-4 w-4"
                    />
                    Open Library
                  </span>
                  <div v-if="row.fieldKey === 'work.cover_url'" class="mt-1">
                    <div
                      class="overflow-hidden rounded border border-[var(--p-content-border-color)]"
                    >
                      <Image
                        v-if="toEnrichmentImageUrl(row.byProvider.openlibrary?.value)"
                        :src="toEnrichmentImageUrl(row.byProvider.openlibrary?.value) || ''"
                        alt=""
                        :preview="false"
                        class="h-36 w-full bg-black/5"
                        image-class="h-full w-full object-contain"
                      />
                      <div
                        v-else
                        class="flex h-36 items-center justify-center bg-[var(--p-surface-100)] px-2 text-sm text-[var(--p-text-muted-color)] dark:bg-[var(--p-surface-800)]"
                      >
                        No Open Library result
                      </div>
                    </div>
                    <details
                      v-if="formatEnrichmentValue(row.byProvider.openlibrary?.display_value)"
                      class="mt-2 text-xs text-[var(--p-text-muted-color)]"
                    >
                      <summary class="cursor-pointer select-none">Show raw URL</summary>
                      <p class="mt-2 break-all">
                        {{ formatEnrichmentValue(row.byProvider.openlibrary?.display_value) }}
                      </p>
                    </details>
                  </div>
                  <p v-else class="whitespace-pre-wrap break-words text-sm">
                    {{
                      formatEnrichmentValue(row.byProvider.openlibrary?.display_value) ||
                      'No suggestion'
                    }}
                  </p>
                  <p
                    v-if="row.byProvider.openlibrary?.source_label"
                    class="text-xs text-[var(--p-text-muted-color)]"
                  >
                    {{ row.byProvider.openlibrary?.source_label }}
                  </p>
                </label>

                <label
                  class="flex flex-col gap-2 rounded border p-3 transition"
                  :class="
                    !row.byProvider.googlebooks
                      ? 'cursor-not-allowed opacity-60'
                      : enrichSelectionByField[row.fieldKey] === 'googlebooks'
                        ? 'cursor-pointer border-primary bg-primary/5'
                        : 'cursor-pointer border-[var(--p-content-border-color)]'
                  "
                  :data-test="`book-enrich-cell-${row.fieldKey}-googlebooks`"
                >
                  <span class="inline-flex items-center gap-2 text-sm font-medium">
                    <input
                      type="radio"
                      v-model="enrichSelectionByField[row.fieldKey]"
                      :name="`pick-${row.fieldKey}`"
                      value="googlebooks"
                      :disabled="!row.byProvider.googlebooks"
                      class="h-4 w-4"
                    />
                    Google Books
                  </span>
                  <div v-if="row.fieldKey === 'work.cover_url'" class="mt-1">
                    <div
                      class="overflow-hidden rounded border border-[var(--p-content-border-color)]"
                    >
                      <Image
                        v-if="toEnrichmentImageUrl(row.byProvider.googlebooks?.value)"
                        :src="toEnrichmentImageUrl(row.byProvider.googlebooks?.value) || ''"
                        alt=""
                        :preview="false"
                        class="h-36 w-full bg-black/5"
                        image-class="h-full w-full object-contain"
                      />
                      <div
                        v-else
                        class="flex h-36 items-center justify-center bg-[var(--p-surface-100)] px-2 text-sm text-[var(--p-text-muted-color)] dark:bg-[var(--p-surface-800)]"
                      >
                        No Google Books result
                      </div>
                    </div>
                    <details
                      v-if="formatEnrichmentValue(row.byProvider.googlebooks?.display_value)"
                      class="mt-2 text-xs text-[var(--p-text-muted-color)]"
                    >
                      <summary class="cursor-pointer select-none">Show raw URL</summary>
                      <p class="mt-2 break-all">
                        {{ formatEnrichmentValue(row.byProvider.googlebooks?.display_value) }}
                      </p>
                    </details>
                  </div>
                  <p v-else class="whitespace-pre-wrap break-words text-sm">
                    {{
                      formatEnrichmentValue(row.byProvider.googlebooks?.display_value) ||
                      'No suggestion'
                    }}
                  </p>
                  <p
                    v-if="row.byProvider.googlebooks?.source_label"
                    class="text-xs text-[var(--p-text-muted-color)]"
                  >
                    {{ row.byProvider.googlebooks?.source_label }}
                  </p>
                </label>
              </div>
            </template>
          </Card>
        </div>

        <div class="flex justify-end gap-2">
          <Button
            label="Cancel"
            severity="secondary"
            variant="text"
            :disabled="enrichApplying"
            @click="enrichDialogVisible = false"
          />
          <Button
            label="Apply selections"
            :loading="enrichApplying"
            data-test="book-enrich-apply"
            @click="applyEnrichmentSelections"
          />
        </div>
      </div>
    </Dialog>

    <!-- Remove-from-library dialog -->
    <Dialog
      v-model:visible="removeConfirmOpen"
      modal
      header="Remove from library"
      :draggable="false"
      style="width: 32rem"
      data-test="book-remove-dialog"
    >
      <div class="flex flex-col gap-4">
        <div>
          <p class="text-sm text-[var(--p-text-muted-color)]">
            Remove "{{ work?.title || '' }}" from your library? This cannot be undone.
          </p>
        </div>
        <div class="flex items-center justify-end gap-2">
          <Button
            label="Cancel"
            severity="secondary"
            variant="text"
            data-test="book-remove-cancel"
            :disabled="removeConfirmLoading"
            @click="cancelRemoveConfirm"
          />
          <Button
            label="Remove"
            severity="danger"
            data-test="book-remove-confirm"
            :loading="removeConfirmLoading"
            @click="confirmRemove"
          />
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

    <BookDiscoverySection
      v-if="work"
      :work-id="workId"
      :authors="work.authors || []"
      data-test="book-discovery"
    />
  </div>
</template>

<script setup lang="ts">
definePageMeta({ layout: 'app', middleware: 'auth' });

import { computed, onMounted, ref, watch } from 'vue';
import { navigateTo, useRoute } from '#imports';
import { useToast } from 'primevue/usetoast';
import { ApiClientError, apiRequest } from '~/utils/api';
import { renderDescriptionHtml } from '~/utils/description';
import { libraryStatusLabel } from '~/utils/libraryStatus';
import {
  canConvert,
  fromCanonicalPercent,
  toCanonicalPercent,
  type ProgressUnit,
} from '~/utils/progressConversion';
import BookDiscoverySection from '~/components/books/BookDiscoverySection.vue';
import CoverPlaceholder from '~/components/CoverPlaceholder.vue';
import type { FileUploadSelectEvent } from 'primevue/fileupload';

const toast = useToast();

type WorkDetail = {
  id: string;
  title: string;
  description: string | null;
  cover_url: string | null;
  total_pages: number | null;
  total_audio_minutes: number | null;
  authors: { id: string; name: string }[];
  identifiers?: {
    isbn10?: string | null;
    isbn13?: string | null;
    asin?: string | null;
  } | null;
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
  library_item_id: string;
  reading_session_id: string;
  logged_at: string;
  unit: ProgressUnit;
  value: number;
  canonical_percent: number | null;
  note: string | null;
};

type ReadCycle = {
  id: string;
  started_at: string;
  conversion?: {
    total_pages: number | null;
    total_audio_minutes: number | null;
  };
};

type BookStatisticsPayload = {
  library_item_id: string;
  window: {
    days: number;
    tz: string;
    start_date: string;
    end_date: string;
  };
  totals: {
    total_pages: number | null;
    total_audio_minutes: number | null;
  };
  counts: {
    total_cycles: number;
    completed_cycles: number;
    imported_cycles: number;
    completed_reads: number;
    total_logs: number;
    logs_with_canonical: number;
    logs_missing_canonical: number;
  };
  current: {
    latest_logged_at: string | null;
    canonical_percent: number;
    pages_read: number | null;
    minutes_listened: number | null;
  };
  streak: {
    non_zero_days: number;
    last_non_zero_date: string | null;
  };
  series: {
    progress_over_time: Array<{
      date: string;
      canonical_percent: number;
      pages_read: number | null;
      minutes_listened: number | null;
    }>;
    daily_delta: Array<{
      date: string;
      canonical_percent_delta: number;
      pages_read_delta: number | null;
      minutes_listened_delta: number | null;
    }>;
  };
  timeline: Array<{
    log_id: string;
    logged_at: string;
    date: string;
    unit: ProgressUnit;
    value: number;
    note: string | null;
    start_value: number;
    end_value: number;
    session_delta: number;
  }>;
  data_quality: {
    has_missing_totals: boolean;
    unresolved_logs_exist: boolean;
    unresolved_log_ids: string[];
  };
};

type MeProfile = {
  default_progress_unit: ProgressUnit;
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

type EnrichmentCandidate = {
  provider: 'openlibrary' | 'googlebooks';
  provider_id: string;
  value: unknown;
  display_value: string;
  source_label: string;
};

type EnrichmentField = {
  field_key: string;
  scope: 'work' | 'edition';
  current_value: unknown;
  candidates: EnrichmentCandidate[];
  has_conflict: boolean;
};

type EnrichmentProvider = 'openlibrary' | 'googlebooks';
type EnrichmentSelection = 'keep' | EnrichmentProvider;
type EnrichmentRow = {
  fieldKey: string;
  label: string;
  currentValue: unknown;
  byProvider: Partial<Record<EnrichmentProvider, EnrichmentCandidate>>;
  hasConflict: boolean;
};

const route = useRoute();
const workId = computed(() => String(route.params.workId || ''));

const coreLoading = ref(true);
const error = ref('');
const statusSaving = ref(false);
const statusEditorOpen = ref(false);
const statusEditorValue = ref<'to_read' | 'reading' | 'completed' | 'abandoned'>('to_read');

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
const savingTotals = ref(false);
const sessionProgressUnit = ref<ProgressUnit>('pages_read');
const sessionProgressValue = ref(0);
const sessionLoggedDate = ref(new Date());
const sessionNote = ref('');
const conversionError = ref('');
const conversionMissing = ref<Array<'total_pages' | 'total_audio_minutes'>>([]);
const pendingTotalPages = ref('');
const pendingTotalAudioMinutes = ref('');
const pendingTargetUnit = ref<ProgressUnit | null>(null);
const totalPageSuggestions = ref<number[]>([]);
const totalTimeSuggestions = ref<number[]>([]);
const loadingTotalsSuggestions = ref(false);
const activeCycle = ref<ReadCycle | null>(null);
const totalsEditionId = ref<string | null>(null);
const defaultProgressUnit = ref<ProgressUnit>('pages_read');
const showConvertUnitSelect = ref(false);
const convertUnitSelection = ref<ProgressUnit>('pages_read');
const showMissingTotalsForm = ref(false);
const bookStatistics = ref<BookStatisticsPayload | null>(null);
const editingKnobValue = ref(false);
const knobEditValue = ref('0');
const confirmDecreaseVisible = ref(false);
const progressChartMode = ref<'progress' | 'daily_delta'>('progress');

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
type CoverCandidate = {
  source: 'openlibrary' | 'googlebooks';
  source_id: string;
  cover_id?: number | null;
  source_url?: string | null;
  thumbnail_url: string;
  image_url: string;
};
const coverCandidates = ref<CoverCandidate[]>([]);
const coverSelectingKey = ref<string | null>(null);
const enrichDialogVisible = ref(false);
const enrichLoading = ref(false);
const enrichApplying = ref(false);
const enrichError = ref('');
const enrichEditionTarget = ref<{ id: string; label: string } | null>(null);
const enrichProviderWarnings = ref<string[]>([]);
const enrichFields = ref<EnrichmentField[]>([]);
const enrichSelectionByField = ref<Record<string, EnrichmentSelection>>({});

const removeConfirmOpen = ref(false);
const removeConfirmLoading = ref(false);

const runId = ref(0);

const needsEditionSelection = computed(
  () => Boolean(libraryItem.value) && !libraryItem.value?.preferred_edition_id,
);

const effectiveCoverUrl = computed(
  () => libraryItem.value?.cover_url ?? work.value?.cover_url ?? null,
);

const identifierSummary = computed(() => {
  const ids = work.value?.identifiers;
  if (!ids) return [];
  const values: string[] = [];
  if (ids.isbn10) values.push(`ISBN-10 ${ids.isbn10}`);
  if (ids.isbn13) values.push(`ISBN-13 ${ids.isbn13}`);
  if (ids.asin) values.push(`ASIN ${ids.asin}`);
  return values;
});

/* c8 ignore start */
const enrichRows = computed<EnrichmentRow[]>(() =>
  [...enrichFields.value]
    .sort((a, b) => {
      const aIsCover = a.field_key === 'work.cover_url';
      const bIsCover = b.field_key === 'work.cover_url';
      if (aIsCover && !bIsCover) return -1;
      if (!aIsCover && bIsCover) return 1;
      return 0;
    })
    .map((field) => {
      const byProvider: Partial<Record<EnrichmentProvider, EnrichmentCandidate>> = {};
      for (const candidate of field.candidates) {
        byProvider[candidate.provider] = candidate;
      }
      return {
        fieldKey: field.field_key,
        label: enrichmentFieldLabel(field.field_key),
        currentValue: field.current_value,
        byProvider,
        hasConflict: field.has_conflict,
      };
    }),
);

/* c8 ignore stop */
const renderedDescriptionHtml = computed(() => {
  return renderDescriptionHtml(work.value?.description);
});

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

const statusOptions = [
  { label: 'To read', value: 'to_read' },
  { label: 'Reading', value: 'reading' },
  { label: 'Completed', value: 'completed' },
  { label: 'Abandoned', value: 'abandoned' },
];

const updateNewNoteVisibility = (value: string | null | undefined) => {
  newNoteVisibility.value = (value || 'private') as 'private' | 'unlisted' | 'public';
};

const updateEditNoteVisibility = (value: string | null | undefined) => {
  editNoteVisibility.value = (value || 'private') as 'private' | 'unlisted' | 'public';
};

const updateNewHighlightVisibility = (value: string | null | undefined) => {
  newHighlightVisibility.value = (value || 'private') as 'private' | 'unlisted' | 'public';
};

const setEnrichmentSelection = (fieldKey: string, selection: EnrichmentSelection) => {
  enrichSelectionByField.value[fieldKey] = selection;
};

const progressUnitOptions = [
  { label: 'Pages', value: 'pages_read' },
  { label: 'Percent', value: 'percent_complete' },
  { label: 'Time', value: 'minutes_listened' },
];

const enrichmentFieldLabels: Record<string, string> = {
  'work.description': 'Description',
  'work.cover_url': 'Cover URL',
  'work.first_publish_year': 'First publish year',
  'edition.publisher': 'Publisher',
  'edition.publish_date': 'Publish date',
  'edition.isbn10': 'ISBN-10',
  'edition.isbn13': 'ISBN-13',
  'edition.language': 'Language',
  'edition.format': 'Format',
};

const formatDate = (value: string) => {
  try {
    return new Date(value).toLocaleString();
  } catch {
    /* c8 ignore next */
    return value;
  }
};

const formatDateOnly = (value: string) => {
  try {
    return new Date(value).toLocaleDateString();
  } catch {
    return value;
  }
};

const enrichmentFieldLabel = (fieldKey: string) => {
  return enrichmentFieldLabels[fieldKey] || fieldKey;
};

const formatEnrichmentValue = (value: unknown): string => {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(value);
};

const toEnrichmentImageUrl = (value: unknown): string | null => {
  const text = formatEnrichmentValue(value).trim();
  if (!text) return null;
  if (text.startsWith('http://') || text.startsWith('https://')) return text;
  return null;
};

const canPickProvider = (provider: EnrichmentProvider): boolean => {
  return enrichRows.value.some((row) => Boolean(row.byProvider[provider]));
};

const resetSectionState = () => {
  statusEditorOpen.value = false;
  statusSaving.value = false;
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
  activeCycle.value = null;
  sessionProgressValue.value = 0;
  sessionLoggedDate.value = new Date();
  sessionNote.value = '';
  conversionError.value = '';
  conversionMissing.value = [];
  pendingTotalPages.value = '';
  pendingTotalAudioMinutes.value = '';
  pendingTargetUnit.value = null;
  totalsEditionId.value = null;
  showConvertUnitSelect.value = false;
  convertUnitSelection.value = defaultProgressUnit.value;
  showMissingTotalsForm.value = false;
  bookStatistics.value = null;
  editingKnobValue.value = false;
  knobEditValue.value = '0';
  confirmDecreaseVisible.value = false;
  progressChartMode.value = 'progress';

  enrichDialogVisible.value = false;
  enrichLoading.value = false;
  enrichApplying.value = false;
  enrichError.value = '';
  enrichEditionTarget.value = null;
  enrichProviderWarnings.value = [];
  enrichFields.value = [];
  enrichSelectionByField.value = {};
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
    const cyclesPayload = await apiRequest<{ items: ReadCycle[] }>(
      `/api/v1/library/items/${libraryItem.value.id}/read-cycles`,
      { query: { limit: 1 } },
    );
    if (id !== runId.value) return;
    const cycle = cyclesPayload.items[0] ?? null;
    activeCycle.value = cycle;

    if (cycle?.conversion && work.value) {
      work.value.total_pages = cycle.conversion.total_pages;
      work.value.total_audio_minutes = cycle.conversion.total_audio_minutes;
    }

    if (!cycle) {
      sessions.value = [];
      sessionProgressUnit.value = coerceProgressUnit(defaultProgressUnit.value);
      convertUnitSelection.value = sessionProgressUnit.value;
      sessionProgressValue.value = 0;
      await loadStatistics();
      return;
    }

    const payload = await apiRequest<{ items: ReadingSession[] }>(
      `/api/v1/read-cycles/${cycle.id}/progress-logs`,
      { query: { limit: 200 } },
    );
    if (id !== runId.value) return;
    sessions.value = payload.items;
    const latest = sessions.value[0] ?? null;
    if (latest) {
      const coercedUnit = coerceProgressUnit(latest.unit);
      sessionProgressUnit.value = coercedUnit;
      convertUnitSelection.value = sessionProgressUnit.value;
      if (coercedUnit === latest.unit) {
        sessionProgressValue.value = latest.value;
      } else {
        const canonical =
          typeof latest.canonical_percent === 'number'
            ? latest.canonical_percent
            : toCanonicalPercent(latest.unit, latest.value, progressTotals.value);
        if (canonical === null) {
          sessionProgressValue.value = 0;
        } else {
          const converted = fromCanonicalPercent(coercedUnit, canonical, progressTotals.value);
          sessionProgressValue.value = converted ?? 0;
        }
      }
    } else {
      sessionProgressUnit.value = coerceProgressUnit(defaultProgressUnit.value);
      convertUnitSelection.value = sessionProgressUnit.value;
      sessionProgressValue.value = 0;
    }
    await loadStatistics();
  } catch (err) {
    if (id !== runId.value) return;
    sessionsError.value = err instanceof ApiClientError ? err.message : 'Unable to load sessions.';
  } finally {
    if (id === runId.value) {
      sessionsLoading.value = false;
    }
  }
};

const detectTimeZone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    /* c8 ignore next */
    return 'UTC';
  }
};

const loadStatistics = async () => {
  if (!libraryItem.value) return;
  try {
    const payload = await apiRequest<BookStatisticsPayload>(
      `/api/v1/library/items/${libraryItem.value.id}/statistics`,
      {
        query: {
          tz: detectTimeZone(),
          days: 90,
        },
      },
    );
    bookStatistics.value = payload;
    if (work.value) {
      work.value.total_pages = payload.totals.total_pages;
      work.value.total_audio_minutes = payload.totals.total_audio_minutes;
    }
  } catch {
    // Keep local fallback behavior when stats are temporarily unavailable.
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
  await loadDefaultProgressUnit();
  /* c8 ignore next 2 */
  if (id !== runId.value) return;
  if (!libraryItem.value) return;

  void loadSessions();
  void loadNotes();
  void loadHighlights();
  void loadReview();
};

const openStatusEditor = () => {
  /* c8 ignore next */
  if (!libraryItem.value) return;
  statusEditorValue.value = libraryItem.value.status as
    | 'to_read'
    | 'reading'
    | 'completed'
    | 'abandoned';
  statusEditorOpen.value = true;
};

const onStatusSelected = async (nextStatus: 'to_read' | 'reading' | 'completed' | 'abandoned') => {
  /* c8 ignore next */
  if (!libraryItem.value) return;
  statusEditorOpen.value = false;
  /* c8 ignore next */
  if (nextStatus === libraryItem.value.status) return;
  statusSaving.value = true;
  error.value = '';
  try {
    await apiRequest(`/api/v1/library/items/${libraryItem.value.id}`, {
      method: 'PATCH',
      body: { status: nextStatus },
    });
    libraryItem.value.status = nextStatus;
    statusEditorValue.value = nextStatus;
  } catch (err) {
    error.value = err instanceof ApiClientError ? err.message : 'Unable to update status.';
  } finally {
    statusSaving.value = false;
  }
};

const openRemoveConfirm = () => {
  removeConfirmOpen.value = true;
};

const cancelRemoveConfirm = () => {
  if (removeConfirmLoading.value) return;
  removeConfirmOpen.value = false;
};

const confirmRemove = async () => {
  if (!libraryItem.value) return;
  removeConfirmLoading.value = true;
  error.value = '';
  try {
    await apiRequest(`/api/v1/library/items/${libraryItem.value.id}`, { method: 'DELETE' });
    toast.add({ severity: 'success', summary: 'Removed from your library.', life: 2500 });
    removeConfirmOpen.value = false;
    await navigateTo('/library');
  } catch (err) {
    if (err instanceof ApiClientError && err.status === 404) {
      toast.add({
        severity: 'info',
        summary: 'This item was already removed. Refreshing...',
        life: 3000,
      });
      removeConfirmOpen.value = false;
      await navigateTo('/library');
    } else {
      const msg =
        err instanceof ApiClientError ? err.message : 'Unable to remove this item right now.';
      toast.add({ severity: 'error', summary: msg, life: 3000 });
      error.value = msg;
    }
  } finally {
    removeConfirmLoading.value = false;
  }
};

const openCoverDialog = async () => {
  coverError.value = '';
  coverBusy.value = false;
  coverMode.value = 'choose';
  coverFile.value = null;
  coverSourceUrl.value = '';
  coverCandidates.value = [];
  coverCandidatesLoading.value = false;
  coverSelectingKey.value = null;

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
    const payload = await apiRequest<{ items: CoverCandidate[] }>(
      `/api/v1/works/${workId.value}/covers`,
    );
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

const coverCandidateKey = (candidate: CoverCandidate): string => {
  if (candidate.source === 'openlibrary' && typeof candidate.cover_id === 'number') {
    return String(candidate.cover_id);
  }
  if (candidate.source_id) return candidate.source_id;
  return candidate.image_url;
};

const selectCoverCandidate = async (candidate: CoverCandidate) => {
  coverBusy.value = true;
  coverError.value = '';
  coverSelectingKey.value = coverCandidateKey(candidate);
  try {
    const body =
      candidate.source === 'openlibrary' && typeof candidate.cover_id === 'number'
        ? { cover_id: candidate.cover_id }
        : { source_url: candidate.source_url || candidate.image_url };
    await apiRequest(`/api/v1/works/${workId.value}/covers/select`, {
      method: 'POST',
      body,
    });
    coverDialogVisible.value = false;
    await refresh();
  } catch (err) {
    coverError.value = err instanceof ApiClientError ? err.message : 'Unable to set cover.';
  } finally {
    coverBusy.value = false;
    coverSelectingKey.value = null;
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

/* c8 ignore start */
const initializeEnrichmentSelections = (fields: EnrichmentField[]) => {
  const selectionByField: Record<string, EnrichmentSelection> = {};
  for (const field of fields) {
    selectionByField[field.field_key] = 'keep';
  }
  enrichSelectionByField.value = selectionByField;
};

const loadEnrichmentCandidates = async () => {
  enrichLoading.value = true;
  enrichError.value = '';
  try {
    const payload = await apiRequest<{
      work_id: string;
      edition_target: { id: string; label: string } | null;
      providers: {
        attempted?: EnrichmentProvider[];
        failed?: { provider: string; code?: string; message?: string }[];
      };
      fields: EnrichmentField[];
    }>(`/api/v1/works/${workId.value}/enrichment/candidates`);
    enrichEditionTarget.value = payload.edition_target;
    enrichFields.value = payload.fields || [];
    enrichProviderWarnings.value = (payload.providers?.failed || []).map((entry) => {
      const provider = entry.provider === 'googlebooks' ? 'Google Books' : 'Open Library';
      return `${provider}: ${entry.message || 'Unavailable right now.'}`;
    });
    initializeEnrichmentSelections(enrichFields.value);
  } catch (err) {
    enrichFields.value = [];
    enrichEditionTarget.value = null;
    enrichProviderWarnings.value = [];
    enrichError.value =
      err instanceof ApiClientError ? err.message : 'Unable to load enrichment candidates.';
  } finally {
    enrichLoading.value = false;
  }
};

const openEnrichmentDialog = async () => {
  enrichDialogVisible.value = true;
  enrichError.value = '';
  enrichProviderWarnings.value = [];
  await loadEnrichmentCandidates();
};

const pickAllFromProvider = async (provider: EnrichmentProvider) => {
  if (enrichLoading.value || enrichApplying.value) {
    return;
  }
  const next = { ...enrichSelectionByField.value };
  for (const row of enrichRows.value) {
    if (row.byProvider[provider]) {
      next[row.fieldKey] = provider;
    }
  }
  enrichSelectionByField.value = next;
  await applyEnrichmentSelections();
};

const resetAllToCurrent = () => {
  const next = { ...enrichSelectionByField.value };
  for (const row of enrichRows.value) {
    next[row.fieldKey] = 'keep';
  }
  enrichSelectionByField.value = next;
};

const applyEnrichmentSelections = async () => {
  enrichApplying.value = true;
  enrichError.value = '';
  try {
    const selections = enrichRows.value
      .map((row) => {
        const selectedValue = enrichSelectionByField.value[row.fieldKey] || 'keep';
        if (selectedValue === 'keep') return null;
        const selectedCandidate = row.byProvider[selectedValue];
        if (!selectedCandidate) return null;
        return {
          field_key: row.fieldKey,
          provider: selectedCandidate.provider,
          provider_id: selectedCandidate.provider_id,
          value: selectedCandidate.value,
        };
      })
      .filter(
        (
          entry,
        ): entry is { field_key: string; provider: string; provider_id: string; value: unknown } =>
          Boolean(entry && entry.field_key && entry.provider && entry.provider_id),
      );

    const payload = await apiRequest<{
      updated: string[];
      skipped: { field_key: string; reason: string }[];
    }>(`/api/v1/works/${workId.value}/enrichment/apply`, {
      method: 'POST',
      body: {
        edition_id: enrichEditionTarget.value?.id || null,
        selections,
      },
    });

    toast.add({
      severity: 'success',
      summary: `Updated ${payload.updated.length} fields${payload.skipped.length ? `, skipped ${payload.skipped.length}` : ''}.`,
      life: 3000,
    });
    enrichDialogVisible.value = false;
    await refresh();
  } catch (err) {
    enrichError.value =
      err instanceof ApiClientError ? err.message : 'Unable to apply enrichment selections.';
  } finally {
    enrichApplying.value = false;
  }
};
/* c8 ignore stop */

/* c8 ignore start */
const progressTotals = computed(() => ({
  total_pages: bookStatistics.value?.totals?.total_pages ?? work.value?.total_pages ?? null,
  total_audio_minutes:
    bookStatistics.value?.totals?.total_audio_minutes ?? work.value?.total_audio_minutes ?? null,
}));

const todayDate = computed(() => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
});

const showActiveLogger = computed(() => libraryItem.value?.status === 'reading');

const progressUnitLabel = (unit: ProgressUnit): string => {
  if (unit === 'percent_complete') return 'Percent';
  if (unit === 'minutes_listened') return 'Time';
  return 'Pages';
};

const latestProgressLog = computed(() => sessions.value[0] ?? null);
const isFirstProgressLog = computed(() => latestProgressLog.value === null);
const lastLoggedValue = computed(() => latestProgressLog.value?.value ?? 0);

const toLocalDateKey = (input: string): string => {
  const date = new Date(input);
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
};

const streakDays = computed(() => {
  if (bookStatistics.value?.streak) {
    return bookStatistics.value.streak.non_zero_days ?? 0;
  }
  const uniqueDays: string[] = [];
  for (const log of sessions.value) {
    const canonical = toCanonicalPercent(log.unit, log.value, progressTotals.value);
    const hasProgress = canonical === null ? log.value > 0 : canonical > 0;
    if (!hasProgress) continue;
    const dayKey = toLocalDateKey(log.logged_at);
    if (!uniqueDays.includes(dayKey)) uniqueDays.push(dayKey);
  }
  if (!uniqueDays.length) return 0;

  let streak = 1;
  let previousDate = new Date(sessions.value[0]!.logged_at);
  for (let index = 1; index < sessions.value.length; index += 1) {
    const candidate = sessions.value[index]!;
    const candidateDate = new Date(candidate.logged_at);
    const previousDay = new Date(
      previousDate.getFullYear(),
      previousDate.getMonth(),
      previousDate.getDate() - 1,
    );
    const expected = `${previousDay.getFullYear()}-${previousDay.getMonth() + 1}-${previousDay.getDate()}`;
    const actual = `${candidateDate.getFullYear()}-${candidateDate.getMonth() + 1}-${candidateDate.getDate()}`;
    if (actual !== expected) break;
    streak += 1;
    previousDate = candidateDate;
  }
  return streak;
});

const resolveCanonicalFromLog = (log: ReadingSession): number => {
  if (typeof log.canonical_percent === 'number') {
    return Math.round(Math.min(100, Math.max(0, log.canonical_percent)));
  }
  const calculated = toCanonicalPercent(log.unit, log.value, progressTotals.value);
  return calculated === null ? 0 : Math.round(calculated);
};

const currentCanonicalPercent = computed(() => {
  const calculated = toCanonicalPercent(
    sessionProgressUnit.value,
    sessionProgressValue.value,
    progressTotals.value,
  );
  if (calculated === null) {
    return latestProgressLog.value ? resolveCanonicalFromLog(latestProgressLog.value) : 0;
  }
  return Math.round(calculated);
});

const formatDuration = (minutesValue: number): string => {
  const totalSeconds = Math.max(0, Math.round(minutesValue * 60));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
};

const formatProgressValue = (unit: ProgressUnit, value: number): string => {
  if (unit === 'percent_complete') return `${Math.round(value)}%`;
  if (unit === 'minutes_listened') return formatDuration(value);
  return String(Math.round(value));
};

const formatProgressDelta = (unit: ProgressUnit, value: number): string => {
  const formatted = formatProgressValue(unit, Math.abs(value));
  if (value < 0) return `-${formatted}`;
  if (value > 0) return `+${formatted}`;
  return formatted;
};

const dayTimestamp = (value: string): number => {
  const date = new Date(value);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
};

const convertCanonicalToUnitValue = (unit: ProgressUnit, canonical: number): number => {
  if (unit === 'percent_complete') return Math.round(canonical);
  const converted = fromCanonicalPercent(unit, canonical, progressTotals.value);
  return converted ?? 0;
};

const timelineSessions = computed(() => {
  if (bookStatistics.value?.timeline) {
    return bookStatistics.value.timeline.map((entry) => ({
      ...entry,
      id: entry.log_id,
      unit: entry.unit,
      note: entry.note,
      logged_at: entry.logged_at,
      start_display: formatProgressValue(entry.unit, entry.start_value),
      end_display: formatProgressValue(entry.unit, entry.end_value),
      session_display: formatProgressDelta(entry.unit, entry.session_delta),
      session_delta: entry.session_delta,
    }));
  }
  const chronological = [...sessions.value].sort(
    (left, right) => new Date(left.logged_at).getTime() - new Date(right.logged_at).getTime(),
  );

  const progressionById = new Map<
    string,
    { startValue: number; endValue: number; sessionValue: number }
  >();
  let previousCanonical = 0;
  for (const log of chronological) {
    const endCanonical = resolveCanonicalFromLog(log);
    const startCanonical = previousCanonical;
    const startValue = convertCanonicalToUnitValue(log.unit, startCanonical);
    const endValue =
      log.unit === 'percent_complete' ? Math.round(log.value) : Math.max(0, log.value);
    progressionById.set(log.id, {
      startValue,
      endValue,
      sessionValue: endValue - startValue,
    });
    previousCanonical = endCanonical;
  }

  return [...sessions.value]
    .sort((left, right) => {
      const leftDay = dayTimestamp(left.logged_at);
      const rightDay = dayTimestamp(right.logged_at);
      if (leftDay !== rightDay) return rightDay - leftDay;
      if (right.value !== left.value) return right.value - left.value;
      return new Date(right.logged_at).getTime() - new Date(left.logged_at).getTime();
    })
    .map((log) => {
      const progression = progressionById.get(log.id) || {
        startValue: 0,
        endValue: 0,
        sessionValue: 0,
      };
      return {
        ...log,
        start_display: formatProgressValue(log.unit, progression.startValue),
        end_display: formatProgressValue(log.unit, progression.endValue),
        session_display: formatProgressDelta(log.unit, progression.sessionValue),
        session_delta: progression.sessionValue,
      };
    });
});

const displayPagesValue = computed(() => {
  if (bookStatistics.value?.current) {
    return Math.round(bookStatistics.value.current.pages_read ?? 0);
  }
  if (sessionProgressUnit.value === 'pages_read') return Math.round(sessionProgressValue.value);
  const canonical = toCanonicalPercent(
    sessionProgressUnit.value,
    sessionProgressValue.value,
    progressTotals.value,
  );
  const converted =
    canonical === null ? null : fromCanonicalPercent('pages_read', canonical, progressTotals.value);
  return converted ?? 0;
});

const displayPercentValue = computed(() => {
  if (bookStatistics.value?.current) {
    return Math.round(bookStatistics.value.current.canonical_percent ?? 0);
  }
  const canonical = toCanonicalPercent(
    sessionProgressUnit.value,
    sessionProgressValue.value,
    progressTotals.value,
  );
  return canonical === null ? 0 : Math.round(canonical);
});

const displayMinutesValue = computed(() => {
  if (bookStatistics.value?.current) {
    return Math.round(bookStatistics.value.current.minutes_listened ?? 0);
  }
  if (sessionProgressUnit.value === 'minutes_listened')
    return Math.round(sessionProgressValue.value);
  const canonical = toCanonicalPercent(
    sessionProgressUnit.value,
    sessionProgressValue.value,
    progressTotals.value,
  );
  const converted =
    canonical === null
      ? null
      : fromCanonicalPercent('minutes_listened', canonical, progressTotals.value);
  return converted ?? 0;
});

const progressPagesDisplay = computed(() => displayPagesValue.value);
const progressPercentDisplay = computed(() => displayPercentValue.value);
const progressTimeDisplay = computed(() => formatDuration(displayMinutesValue.value));
const totalsPagesDisplay = computed(() => progressTotals.value.total_pages ?? 0);
const totalsTimeDisplay = computed(() =>
  formatDuration(progressTotals.value.total_audio_minutes ?? 0),
);
const knobDisplayValue = computed(() => {
  if (sessionProgressUnit.value === 'percent_complete') {
    return `${sessionProgressValue.value}%`;
  }
  if (sessionProgressUnit.value === 'minutes_listened') {
    return formatDuration(sessionProgressValue.value);
  }
  return String(sessionProgressValue.value);
});

const progressSliderMax = computed(() => {
  if (sessionProgressUnit.value === 'percent_complete') return 100;
  if (sessionProgressUnit.value === 'pages_read') {
    if (progressTotals.value.total_pages) return progressTotals.value.total_pages;
    return Math.max(100, sessionProgressValue.value + 50);
  }
  if (progressTotals.value.total_audio_minutes) return progressTotals.value.total_audio_minutes;
  return Math.max(100, sessionProgressValue.value + 60);
});

const progressSliderDisabled = computed(() => false);
const progressChartUnit = ref<ProgressUnit>('percent_complete');
const isChartUnitAvailable = (unit: ProgressUnit): boolean => {
  if (unit === 'percent_complete') return true;
  if (unit === 'pages_read') return Boolean(progressTotals.value.total_pages);
  return Boolean(progressTotals.value.total_audio_minutes);
};

const progressChartModeOptions = [
  { label: 'Progress over time', value: 'progress' },
  { label: 'Daily gain', value: 'daily_delta' },
];
const progressChartUnitOptions = computed(() =>
  progressUnitOptions.filter((option) => isChartUnitAvailable(option.value)),
);

watch(
  progressChartUnitOptions,
  (options) => {
    const values = options.map((option) => option.value);
    if (!values.length) {
      progressChartUnit.value = 'percent_complete';
      return;
    }
    if (!values.includes(progressChartUnit.value)) {
      progressChartUnit.value = values[0]!;
    }
  },
  { immediate: true },
);

const resolveValueInUnit = (log: ReadingSession, unit: ProgressUnit): number => {
  if (log.unit === unit) return Math.round(log.value);
  const canonical =
    typeof log.canonical_percent === 'number'
      ? Math.min(100, Math.max(0, log.canonical_percent))
      : toCanonicalPercent(log.unit, log.value, progressTotals.value);
  if (canonical === null) return 0;
  if (unit === 'percent_complete') return Math.round(canonical);
  const converted = fromCanonicalPercent(unit, canonical, progressTotals.value);
  return converted ?? 0;
};

const progressChartData = computed(() => {
  if (bookStatistics.value?.series) {
    const series = bookStatistics.value.series;
    const unitLabel = progressUnitLabel(progressChartUnit.value);
    const readPointValue = (
      point: {
        canonical_percent: number;
        pages_read: number | null;
        minutes_listened: number | null;
      },
      unit: ProgressUnit,
    ) => {
      if (unit === 'pages_read') return point.pages_read ?? 0;
      if (unit === 'minutes_listened') return point.minutes_listened ?? 0;
      return point.canonical_percent;
    };
    const readDeltaValue = (
      point: {
        canonical_percent_delta: number;
        pages_read_delta: number | null;
        minutes_listened_delta: number | null;
      },
      unit: ProgressUnit,
    ) => {
      if (unit === 'pages_read') return point.pages_read_delta ?? 0;
      if (unit === 'minutes_listened') return point.minutes_listened_delta ?? 0;
      return point.canonical_percent_delta;
    };

    if (progressChartMode.value === 'daily_delta') {
      return {
        labels: series.daily_delta.map((point) => point.date),
        datasets: [
          {
            type: 'bar',
            label: `Daily gain (${unitLabel})`,
            data: series.daily_delta.map((point) => readDeltaValue(point, progressChartUnit.value)),
            backgroundColor: '#93c5fd',
          },
        ],
      };
    }

    return {
      labels: series.progress_over_time.map((point) => point.date),
      datasets: [
        {
          label: `Progress (${unitLabel})`,
          data: series.progress_over_time.map((point) =>
            readPointValue(point, progressChartUnit.value),
          ),
          borderColor: '#2563eb',
          backgroundColor: '#bfdbfe',
          fill: false,
          tension: 0.25,
        },
      ],
    };
  }

  const chronological = [...sessions.value].reverse();
  if (!chronological.length) {
    return { labels: [], datasets: [{ label: 'Progress', data: [] }] };
  }

  const unitLabel = progressUnitLabel(progressChartUnit.value);
  if (progressChartMode.value === 'daily_delta') {
    const dayTotals: Record<string, number> = {};
    let previousValue = 0;
    for (const log of chronological) {
      const value = resolveValueInUnit(log, progressChartUnit.value);
      const gain = Math.max(0, value - previousValue);
      const label = formatDateOnly(log.logged_at);
      dayTotals[label] = (dayTotals[label] || 0) + gain;
      previousValue = value;
    }
    return {
      labels: Object.keys(dayTotals),
      datasets: [
        {
          type: 'bar',
          label: `Daily gain (${unitLabel})`,
          data: Object.values(dayTotals),
          backgroundColor: '#93c5fd',
        },
      ],
    };
  }

  return {
    labels: chronological.map((log) => formatDateOnly(log.logged_at)),
    datasets: [
      {
        label: `Progress (${unitLabel})`,
        data: chronological.map((log) => resolveValueInUnit(log, progressChartUnit.value)),
        borderColor: '#2563eb',
        backgroundColor: '#bfdbfe',
        fill: false,
        tension: 0.25,
      },
    ],
  };
});

const progressChartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { display: false },
  },
  scales: {
    y: {
      beginAtZero: true,
    },
  },
};

const normalizeNumericValue = (value: number): number => {
  const rounded = Math.max(0, Math.round(value));
  if (progressSliderDisabled.value) return rounded;
  return Math.min(rounded, progressSliderMax.value);
};

const onProgressValueInput = (value: number | null) => {
  sessionProgressValue.value = normalizeNumericValue(value ?? 0);
};

const startKnobValueEdit = () => {
  editingKnobValue.value = true;
  knobEditValue.value = String(sessionProgressValue.value);
};

const convertUnitOptions = computed(() =>
  progressUnitOptions.map((option) => ({
    ...option,
    disabled:
      option.value !== sessionProgressUnit.value &&
      !canConvert(sessionProgressUnit.value, option.value, progressTotals.value).canConvert,
  })),
);

const ineligibleConvertUnits = computed(() =>
  progressUnitOptions
    .map((option) => option.value)
    .filter(
      (unit) =>
        unit !== sessionProgressUnit.value &&
        !canConvert(sessionProgressUnit.value, unit, progressTotals.value).canConvert,
    ),
);

const isUnitAvailable = (unit: ProgressUnit): boolean => {
  if (unit === 'percent_complete') return true;
  if (unit === 'pages_read') return Boolean(progressTotals.value.total_pages);
  return Boolean(progressTotals.value.total_audio_minutes);
};

const coerceProgressUnit = (preferred: ProgressUnit): ProgressUnit => {
  if (isUnitAvailable(preferred)) return preferred;
  return 'percent_complete';
};

const openConvertUnitPicker = () => {
  showConvertUnitSelect.value = true;
  convertUnitSelection.value = sessionProgressUnit.value;
};

const cancelKnobValueEdit = () => {
  editingKnobValue.value = false;
  knobEditValue.value = String(sessionProgressValue.value);
};

const commitKnobValueEdit = () => {
  const parsed = Number(knobEditValue.value.trim());
  if (Number.isFinite(parsed)) {
    onProgressValueInput(parsed);
  }
  editingKnobValue.value = false;
};

const onConvertUnitChange = (nextUnit: ProgressUnit) => {
  convertUnitSelection.value = nextUnit;
  if (nextUnit === sessionProgressUnit.value) {
    showConvertUnitSelect.value = false;
    return;
  }
  const converted = requestUnitConversion(nextUnit);
  if (!converted) {
    promptMissingTotalsFromIneligible();
  }
  showConvertUnitSelect.value = false;
};

const promptMissingTotalsFromIneligible = () => {
  const required = new Set<'total_pages' | 'total_audio_minutes'>();
  for (const unit of ineligibleConvertUnits.value) {
    const capability = canConvert(sessionProgressUnit.value, unit, progressTotals.value);
    for (const missing of capability.missing) {
      required.add(missing);
    }
  }
  conversionMissing.value = [...required];
  showMissingTotalsForm.value = true;
  void loadTotalsSuggestions();
};

const minutesToHms = (minutes: number): string => {
  const totalSeconds = Math.max(0, Math.round(minutes * 60));
  const hours = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours}:${String(mins).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
};

const collectSuggestionValues = (
  fields: Array<{ field_key: string; candidates?: Array<{ value?: unknown }> }>,
  fieldKey: string,
): number[] => {
  const field = fields.find((entry) => entry.field_key === fieldKey);
  if (!field?.candidates?.length) return [];
  const values = field.candidates
    .map((candidate) => candidate.value)
    .map((value) => (typeof value === 'number' ? value : Number(value)))
    .map((value) => (fieldKey === 'edition.total_pages' ? Math.round(value) : value))
    .filter((value) => Number.isFinite(value) && value > 0) as number[];
  return [...new Set(values)];
};

const loadTotalsSuggestions = async () => {
  if (!conversionMissing.value.length) return;
  loadingTotalsSuggestions.value = true;
  try {
    const payload = await apiRequest<{
      fields: Array<{ field_key: string; candidates?: Array<{ value?: unknown }> }>;
    }>(`/api/v1/works/${workId.value}/enrichment/candidates`);
    totalPageSuggestions.value = collectSuggestionValues(payload.fields, 'edition.total_pages');
    totalTimeSuggestions.value = collectSuggestionValues(
      payload.fields,
      'edition.total_audio_minutes',
    );

    if (
      conversionMissing.value.includes('total_pages') &&
      !pendingTotalPages.value.trim() &&
      totalPageSuggestions.value.length
    ) {
      pendingTotalPages.value = String(totalPageSuggestions.value[0]);
    }
    if (
      conversionMissing.value.includes('total_audio_minutes') &&
      !pendingTotalAudioMinutes.value.trim() &&
      totalTimeSuggestions.value.length
    ) {
      pendingTotalAudioMinutes.value = minutesToHms(totalTimeSuggestions.value[0]);
    }
  } catch {
    totalPageSuggestions.value = [];
    totalTimeSuggestions.value = [];
  } finally {
    loadingTotalsSuggestions.value = false;
  }
};

const requestUnitConversion = (targetUnit: ProgressUnit): boolean => {
  const capability = canConvert(sessionProgressUnit.value, targetUnit, progressTotals.value);
  if (!capability.canConvert) {
    conversionMissing.value = capability.missing;
    pendingTargetUnit.value = targetUnit;
    showMissingTotalsForm.value = true;
    void loadTotalsSuggestions();
    return false;
  }

  const canonical = toCanonicalPercent(
    sessionProgressUnit.value,
    sessionProgressValue.value,
    progressTotals.value,
  );
  if (canonical === null) {
    return false;
  }
  const converted = fromCanonicalPercent(targetUnit, canonical, progressTotals.value);
  if (converted === null) {
    return false;
  }

  sessionProgressUnit.value = targetUnit;
  convertUnitSelection.value = targetUnit;
  sessionProgressValue.value = converted;
  conversionError.value = '';
  conversionMissing.value = [];
  pendingTargetUnit.value = null;
  showMissingTotalsForm.value = false;
  return true;
};

const resolveTotalsEditionId = async (): Promise<string> => {
  if (totalsEditionId.value) return totalsEditionId.value;
  if (libraryItem.value?.preferred_edition_id) {
    totalsEditionId.value = libraryItem.value.preferred_edition_id;
    return totalsEditionId.value;
  }
  const payload = await apiRequest<{ items: Array<{ id: string }> }>(
    `/api/v1/works/${workId.value}/editions`,
    { query: { limit: 1 } },
  );
  const fallback = payload.items[0]?.id;
  if (!fallback) {
    throw new ApiClientError('No edition available to update totals.', 'edition_missing', 404);
  }
  totalsEditionId.value = fallback;
  return fallback;
};

const saveMissingTotals = async () => {
  if (!conversionMissing.value.length) return;
  savingTotals.value = true;
  error.value = '';
  try {
    const updates: Record<string, number> = {};
    if (conversionMissing.value.includes('total_pages')) {
      const raw = pendingTotalPages.value.trim();
      if (!/^\d+$/.test(raw)) {
        throw new ApiClientError('Total pages must be at least 1.', 'invalid_total_pages', 400);
      }
      const parsed = Number(raw);
      if (!Number.isFinite(parsed) || parsed < 1) {
        throw new ApiClientError('Total pages must be at least 1.', 'invalid_total_pages', 400);
      }
      updates.total_pages = parsed;
    }
    if (conversionMissing.value.includes('total_audio_minutes')) {
      const raw = pendingTotalAudioMinutes.value.trim();
      const match = /^(\d+):([0-5]\d):([0-5]\d)$/.exec(raw);
      if (!match) {
        throw new ApiClientError(
          'Total time must use hh:mm:ss.',
          'invalid_total_audio_minutes',
          400,
        );
      }
      const hours = Number(match[1]);
      const minutes = Number(match[2]);
      const seconds = Number(match[3]);
      const totalSeconds = hours * 3600 + minutes * 60 + seconds;
      if (totalSeconds <= 0) {
        throw new ApiClientError(
          'Total time must be greater than 0.',
          'invalid_total_audio_minutes',
          400,
        );
      }
      updates.total_audio_minutes = Math.max(1, Math.round(totalSeconds / 60));
    }

    const editionId = await resolveTotalsEditionId();
    const payload = await apiRequest<{
      total_pages: number | null;
      total_audio_minutes: number | null;
    }>(`/api/v1/editions/${editionId}/totals`, {
      method: 'PATCH',
      body: updates,
    });

    if (work.value) {
      work.value.total_pages = payload.total_pages;
      work.value.total_audio_minutes = payload.total_audio_minutes;
    }
    conversionError.value = '';
    conversionMissing.value = [];
    pendingTotalPages.value = '';
    pendingTotalAudioMinutes.value = '';
    showMissingTotalsForm.value = false;

    if (pendingTargetUnit.value) {
      const target = pendingTargetUnit.value;
      pendingTargetUnit.value = null;
      requestUnitConversion(target);
    }
  } catch (err) {
    error.value = err instanceof ApiClientError ? err.message : 'Unable to save totals.';
  } finally {
    savingTotals.value = false;
  }
};

const ensureActiveCycle = async (): Promise<string> => {
  if (!libraryItem.value)
    throw new ApiClientError('Library item not found.', 'library_missing', 404);
  if (activeCycle.value?.id) return activeCycle.value.id;

  const created = await apiRequest<{ id: string }>(
    `/api/v1/library/items/${libraryItem.value.id}/read-cycles`,
    {
      method: 'POST',
      body: {
        started_at: new Date().toISOString(),
      },
    },
  );
  activeCycle.value = {
    id: created.id,
    started_at: new Date().toISOString(),
  };
  return created.id;
};

const loadDefaultProgressUnit = async () => {
  try {
    const me = await apiRequest<MeProfile>('/api/v1/me');
    defaultProgressUnit.value = me.default_progress_unit || 'pages_read';
  } catch {
    defaultProgressUnit.value = 'pages_read';
  }
  if (isFirstProgressLog.value) {
    sessionProgressUnit.value = coerceProgressUnit(defaultProgressUnit.value);
    convertUnitSelection.value = sessionProgressUnit.value;
  }
};

const validateLogDate = (): boolean => {
  const selectedDate = new Date(
    sessionLoggedDate.value.getFullYear(),
    sessionLoggedDate.value.getMonth(),
    sessionLoggedDate.value.getDate(),
  );
  if (selectedDate.getTime() > todayDate.value.getTime()) {
    error.value = 'Progress date cannot be in the future.';
    return false;
  }
  return true;
};

const toLoggedAtIso = (date: Date): string =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0, 0).toISOString();

const submitSessionLog = async () => {
  if (!libraryItem.value) return;
  if (!validateLogDate()) return;
  if (sessionProgressValue.value < 0 || Number.isNaN(sessionProgressValue.value)) {
    error.value = 'Enter a valid progress value.';
    return;
  }

  savingSession.value = true;
  error.value = '';
  try {
    const cycleId = await ensureActiveCycle();
    const normalizedValue =
      sessionProgressUnit.value === 'percent_complete'
        ? Math.min(100, sessionProgressValue.value)
        : sessionProgressValue.value;
    await apiRequest(`/api/v1/read-cycles/${cycleId}/progress-logs`, {
      method: 'POST',
      body: {
        unit: sessionProgressUnit.value,
        value: normalizedValue,
        logged_at: toLoggedAtIso(sessionLoggedDate.value),
        note: sessionNote.value.trim() || null,
      },
    });
    sessionNote.value = '';
    await loadSessions();
  } catch (err) {
    error.value = err instanceof ApiClientError ? err.message : 'Unable to log session.';
  } finally {
    savingSession.value = false;
  }
};

const cancelDecrease = () => {
  confirmDecreaseVisible.value = false;
  sessionProgressValue.value = lastLoggedValue.value;
};

const confirmDecreaseAndLog = async () => {
  confirmDecreaseVisible.value = false;
  await submitSessionLog();
};

const logSession = async () => {
  if (latestProgressLog.value && sessionProgressValue.value < lastLoggedValue.value) {
    confirmDecreaseVisible.value = true;
    return;
  }
  await submitSessionLog();
};
/* c8 ignore stop */

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
