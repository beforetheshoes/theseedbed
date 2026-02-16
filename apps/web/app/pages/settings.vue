<template>
  <Card data-test="settings-card">
    <template #title>
      <div class="flex items-center gap-3">
        <i class="pi pi-cog text-primary" aria-hidden="true" />
        <div>
          <p class="font-serif text-xl font-semibold tracking-tight">Profile and settings</p>
          <p class="text-sm text-[var(--p-text-muted-color)]">
            Manage your profile and external book search preferences.
          </p>
        </div>
      </div>
    </template>
    <template #content>
      <div class="flex flex-col gap-4">
        <Message v-if="error" severity="error" :closable="false" data-test="settings-error">
          {{ error }}
        </Message>
        <Message v-if="saved" severity="success" :closable="false" data-test="settings-saved">
          Settings saved.
        </Message>

        <div class="grid gap-3 md:grid-cols-2">
          <div class="flex flex-col gap-2">
            <label class="text-sm font-medium" for="settings-handle">Handle</label>
            <InputText
              id="settings-handle"
              v-model="handle"
              data-test="settings-handle"
              placeholder="reader_handle"
            />
          </div>
          <div class="flex flex-col gap-2">
            <label class="text-sm font-medium" for="settings-display-name">Display name</label>
            <InputText
              id="settings-display-name"
              v-model="displayName"
              data-test="settings-display-name"
              placeholder="Display name"
            />
          </div>
        </div>

        <div class="flex flex-col gap-2">
          <label class="text-sm font-medium" for="settings-avatar-url">Avatar URL</label>
          <InputText
            id="settings-avatar-url"
            v-model="avatarUrl"
            data-test="settings-avatar-url"
            placeholder="https://example.com/avatar.jpg"
          />
        </div>

        <Card>
          <template #content>
            <div class="flex items-start justify-between gap-4">
              <div>
                <p class="m-0 text-sm font-medium">Use Google Books</p>
                <p class="m-0 text-xs text-[var(--p-text-muted-color)]">
                  Opt in to include Google Books in global search and import results.
                </p>
              </div>
              <input
                v-model="enableGoogleBooks"
                data-test="settings-enable-google-books"
                type="checkbox"
                class="mt-1 h-4 w-4"
              />
            </div>
          </template>
        </Card>

        <Card>
          <template #content>
            <div class="flex items-start justify-between gap-4">
              <div>
                <p class="m-0 text-sm font-medium">Default progress unit</p>
                <p class="m-0 text-xs text-[var(--p-text-muted-color)]">
                  Used as the default unit when logging reading progress.
                </p>
              </div>
              <select
                v-model="defaultProgressUnit"
                data-test="settings-default-progress-unit"
                class="rounded border border-[var(--p-content-border-color)] bg-transparent px-2 py-1 text-sm"
              >
                <option value="pages_read">Pages</option>
                <option value="percent_complete">Percent</option>
                <option value="minutes_listened">Minutes</option>
              </select>
            </div>
          </template>
        </Card>

        <Card class="storygraph-import-card" data-test="storygraph-import-card">
          <template #content>
            <div class="flex flex-col gap-4">
              <div>
                <p class="m-0 text-xl font-semibold tracking-tight">Import StoryGraph export</p>
                <p class="m-0 text-sm text-[var(--p-text-muted-color)]">
                  Upload your StoryGraph CSV export to import library status, ratings, reviews, and
                  reading sessions.
                </p>
              </div>

              <Panel data-test="storygraph-import-steps">
                <template #header>
                  <span class="text-sm font-medium">Import workflow</span>
                </template>
                <div class="grid gap-2 md:grid-cols-3">
                  <div class="flex items-center gap-2">
                    <Tag :severity="storygraphFile ? 'success' : 'secondary'" rounded> Step 1 </Tag>
                    <span class="text-xs">Select CSV</span>
                  </div>
                  <div class="flex items-center gap-2">
                    <Tag :severity="issuesStepSeverity" rounded>Step 2</Tag>
                    <span class="text-xs">Resolve or skip issues</span>
                  </div>
                  <div class="flex items-center gap-2">
                    <Tag :severity="canStartImport ? 'success' : 'secondary'" rounded>Step 3</Tag>
                    <span class="text-xs">Start import</span>
                  </div>
                </div>
              </Panel>

              <div class="flex flex-col gap-2">
                <input
                  ref="storygraphFileInput"
                  class="hidden"
                  style="display: none"
                  data-test="storygraph-file-input"
                  type="file"
                  accept=".csv,text/csv"
                  @change="onStorygraphFileChange"
                />
                <div class="flex flex-wrap gap-2">
                  <Button
                    label="Choose StoryGraph CSV"
                    icon="pi pi-plus"
                    class="w-full md:w-auto"
                    data-test="storygraph-file-choose"
                    @click="openStorygraphPicker"
                  />
                  <Button
                    v-if="storygraphFile"
                    label="Clear"
                    text
                    severity="secondary"
                    data-test="storygraph-file-clear"
                    @click="clearStorygraphSelection"
                  />
                </div>
                <p
                  v-if="storygraphFile"
                  class="m-0 max-w-full truncate text-sm text-[var(--p-text-muted-color)]"
                  :title="storygraphFile.name"
                  data-test="storygraph-selected-file"
                >
                  {{ storygraphFile.name }}
                </p>
                <Button
                  data-test="storygraph-import-start"
                  :label="importing ? 'Importing...' : 'Start import'"
                  :disabled="!canStartImport"
                  :loading="importing"
                  class="w-full"
                  @click="startStorygraphImport"
                />
              </div>

              <Message
                v-if="startDisabledReason"
                severity="secondary"
                :closable="false"
                data-test="storygraph-start-disabled-reason"
              >
                {{ startDisabledReason }}
              </Message>

              <Message
                v-if="issuesLoadError"
                severity="error"
                :closable="false"
                data-test="storygraph-import-issues-error"
              >
                <div class="flex items-center gap-3">
                  <span>{{ issuesLoadError }}</span>
                  <Button
                    v-if="storygraphFile"
                    label="Retry"
                    size="small"
                    text
                    data-test="storygraph-import-issues-retry"
                    @click="retryLoadImportIssues"
                  />
                </div>
              </Message>

              <div v-if="issuesLoading" class="rounded border border-dashed p-3">
                <p
                  class="m-0 text-sm text-[var(--p-text-muted-color)]"
                  data-test="storygraph-issues-loading"
                >
                  Checking CSV for required missing fields...
                </p>
              </div>

              <Panel
                v-if="issuesLoaded && importIssues.length"
                toggleable
                class="storygraph-issues-panel"
                data-test="storygraph-import-issues"
              >
                <template #header>
                  <div class="flex items-center gap-2">
                    <span class="text-sm font-medium">Import issues</span>
                    <Badge
                      :value="String(importIssues.length)"
                      severity="contrast"
                      data-test="storygraph-issue-total-badge"
                    />
                  </div>
                </template>
                <div class="mb-3 flex flex-wrap gap-2" data-test="storygraph-issue-summary">
                  <span class="text-sm text-[var(--p-text-muted-color)]">
                    Resolved:
                    <strong class="text-[var(--p-text-color)]">{{ resolvedIssueCount }}</strong> ·
                    Skipped:
                    <strong class="text-[var(--p-text-color)]">{{ skippedIssueCount }}</strong> ·
                    Pending:
                    <strong class="text-[var(--p-text-color)]">{{ pendingIssueCount }}</strong>
                  </span>
                </div>
                <Card
                  v-for="issue in importIssues"
                  :key="issue.issueKey"
                  class="mt-2"
                  :dt="{
                    shadow: 'none',
                    body: { padding: '1rem', gap: '0.75rem' },
                    title: { fontSize: '0.875rem' },
                  }"
                >
                  <template #title>
                    <div class="flex items-start justify-between gap-2">
                      <span>{{ issueDescription(issue) }}</span>
                      <Tag
                        v-if="issue.resolution !== 'pending'"
                        :severity="issueResolutionSeverity(issue.resolution)"
                        rounded
                        class="shrink-0"
                      >
                        {{ issueResolutionLabel(issue.resolution) }}
                      </Tag>
                    </div>
                  </template>
                  <template #subtitle>Row {{ issue.row_number }} in your CSV</template>
                  <template #content>
                    <div v-if="issue.isEditing">
                      <InputText
                        :model-value="issue.value"
                        :placeholder="issue.placeholder"
                        class="w-full"
                        data-test="storygraph-import-issue-input"
                        @update:model-value="onIssueValueInput(issue, $event)"
                      />
                    </div>
                    <Message
                      v-else-if="issue.suggested_value"
                      severity="info"
                      size="small"
                      variant="simple"
                      :closable="false"
                    >
                      <p class="m-0 text-sm font-medium break-words">
                        {{ issue.suggested_value }}
                      </p>
                      <p
                        v-if="suggestionConfidenceText(issue)"
                        class="m-0 mt-1 text-xs text-[var(--p-text-muted-color)]"
                      >
                        {{ suggestionConfidenceText(issue) }}
                      </p>
                    </Message>
                    <Message
                      v-else
                      severity="secondary"
                      size="small"
                      variant="simple"
                      :closable="false"
                    >
                      No suggestion available
                    </Message>
                  </template>
                  <template #footer>
                    <div class="flex flex-wrap gap-1">
                      <Button
                        v-if="issue.suggested_value && issue.resolution !== 'resolved'"
                        label="Use suggestion"
                        size="small"
                        outlined
                        data-test="storygraph-import-issue-use-suggestion"
                        @click="applySuggestion(issue)"
                      />
                      <Button
                        v-if="!issue.isEditing && issue.resolution !== 'resolved'"
                        label="Edit"
                        size="small"
                        text
                        severity="secondary"
                        data-test="storygraph-import-issue-modify"
                        @click="startIssueEdit(issue)"
                      />
                      <Button
                        v-if="issue.resolution !== 'skipped'"
                        label="Skip"
                        size="small"
                        text
                        severity="secondary"
                        data-test="storygraph-import-issue-mark-skip"
                        @click="markIssueSkipped(issue)"
                      />
                      <Button
                        v-else
                        label="Undo skip"
                        size="small"
                        severity="secondary"
                        text
                        data-test="storygraph-import-issue-undo-skip"
                        @click="undoIssueSkip(issue)"
                      />
                      <Button
                        v-if="issue.isEditing"
                        label="Done"
                        size="small"
                        severity="secondary"
                        text
                        data-test="storygraph-import-issue-done"
                        @click="finishIssueEdit(issue)"
                      />
                    </div>
                  </template>
                </Card>
              </Panel>

              <Message
                v-if="importError"
                severity="error"
                :closable="false"
                data-test="storygraph-import-error"
              >
                {{ importError }}
              </Message>

              <div
                v-if="importJob"
                class="rounded border border-[var(--p-content-border-color)] p-3"
              >
                <p class="m-0 text-sm font-medium" data-test="storygraph-import-status">
                  Status: {{ importJob.status }}
                </p>
                <p
                  class="m-0 text-xs text-[var(--p-text-muted-color)]"
                  data-test="storygraph-import-counts"
                >
                  Processed {{ importJob.processed_rows }} / {{ importJob.total_rows }} (imported
                  {{ importJob.imported_rows }}, failed {{ importJob.failed_rows }}, skipped
                  {{ importJob.skipped_rows }})
                </p>
                <p
                  v-if="importJob.error_summary"
                  class="m-0 text-xs text-[var(--p-text-muted-color)]"
                  data-test="storygraph-import-error-summary"
                >
                  {{ importJob.error_summary }}
                </p>

                <div
                  v-if="importJob.rows_preview?.length"
                  class="mt-2 space-y-1"
                  data-test="storygraph-import-preview"
                >
                  <p class="m-0 text-xs font-semibold">Failed / skipped rows</p>
                  <div
                    v-for="row in importJob.rows_preview"
                    :key="`row-${row.row_number}`"
                    class="text-xs"
                    data-test="storygraph-import-preview-row"
                  >
                    Row {{ row.row_number }}: {{ row.message }}
                  </div>
                </div>
              </div>
            </div>
          </template>
        </Card>

        <Card class="goodreads-import-card" data-test="goodreads-import-card">
          <template #content>
            <div class="flex flex-col gap-4">
              <div>
                <p class="m-0 text-xl font-semibold tracking-tight">Import Goodreads export</p>
                <p class="m-0 text-sm text-[var(--p-text-muted-color)]">
                  Upload your Goodreads CSV export to import library status, ratings, reviews, and
                  reading sessions.
                </p>
              </div>

              <Panel data-test="goodreads-import-steps">
                <template #header>
                  <span class="text-sm font-medium">Import workflow</span>
                </template>
                <div class="grid gap-2 md:grid-cols-3">
                  <div class="flex items-center gap-2">
                    <Tag :severity="goodreadsFile ? 'success' : 'secondary'" rounded> Step 1 </Tag>
                    <span class="text-xs">Select CSV</span>
                  </div>
                  <div class="flex items-center gap-2">
                    <Tag :severity="goodreadsIssuesStepSeverity" rounded>Step 2</Tag>
                    <span class="text-xs">Resolve or skip issues</span>
                  </div>
                  <div class="flex items-center gap-2">
                    <Tag :severity="canStartGoodreadsImport ? 'success' : 'secondary'" rounded
                      >Step 3</Tag
                    >
                    <span class="text-xs">Start import</span>
                  </div>
                </div>
              </Panel>

              <div class="flex flex-col gap-2">
                <input
                  ref="goodreadsFileInput"
                  class="hidden"
                  style="display: none"
                  data-test="goodreads-file-input"
                  type="file"
                  accept=".csv,text/csv"
                  @change="onGoodreadsFileChange"
                />
                <div class="flex flex-wrap gap-2">
                  <Button
                    label="Choose Goodreads CSV"
                    icon="pi pi-plus"
                    class="w-full md:w-auto"
                    data-test="goodreads-file-choose"
                    @click="openGoodreadsPicker"
                  />
                  <Button
                    v-if="goodreadsFile"
                    label="Clear"
                    text
                    severity="secondary"
                    data-test="goodreads-file-clear"
                    @click="clearGoodreadsSelection"
                  />
                </div>
                <p
                  v-if="goodreadsFile"
                  class="m-0 max-w-full truncate text-sm text-[var(--p-text-muted-color)]"
                  :title="goodreadsFile.name"
                  data-test="goodreads-selected-file"
                >
                  {{ goodreadsFile.name }}
                </p>
                <Button
                  data-test="goodreads-import-start"
                  :label="goodreadsImporting ? 'Importing...' : 'Start import'"
                  :disabled="!canStartGoodreadsImport"
                  :loading="goodreadsImporting"
                  class="w-full"
                  @click="startGoodreadsImport"
                />
              </div>

              <Message
                v-if="goodreadsStartDisabledReason"
                severity="secondary"
                :closable="false"
                data-test="goodreads-start-disabled-reason"
              >
                {{ goodreadsStartDisabledReason }}
              </Message>

              <Message
                v-if="goodreadsIssuesLoadError"
                severity="error"
                :closable="false"
                data-test="goodreads-import-issues-error"
              >
                <div class="flex items-center gap-3">
                  <span>{{ goodreadsIssuesLoadError }}</span>
                  <Button
                    v-if="goodreadsFile"
                    label="Retry"
                    size="small"
                    text
                    data-test="goodreads-import-issues-retry"
                    @click="retryLoadGoodreadsImportIssues"
                  />
                </div>
              </Message>

              <div v-if="goodreadsIssuesLoading" class="rounded border border-dashed p-3">
                <p
                  class="m-0 text-sm text-[var(--p-text-muted-color)]"
                  data-test="goodreads-issues-loading"
                >
                  Checking CSV for required missing fields...
                </p>
              </div>

              <Panel
                v-if="goodreadsIssuesLoaded && goodreadsImportIssues.length"
                toggleable
                class="goodreads-issues-panel"
                data-test="goodreads-import-issues"
              >
                <template #header>
                  <div class="flex items-center gap-2">
                    <span class="text-sm font-medium">Import issues</span>
                    <Badge
                      :value="String(goodreadsImportIssues.length)"
                      severity="contrast"
                      data-test="goodreads-issue-total-badge"
                    />
                  </div>
                </template>
                <div class="mb-3 flex flex-wrap gap-2" data-test="goodreads-issue-summary">
                  <span class="text-sm text-[var(--p-text-muted-color)]">
                    Resolved:
                    <strong class="text-[var(--p-text-color)]">{{
                      goodreadsResolvedIssueCount
                    }}</strong>
                    · Skipped:
                    <strong class="text-[var(--p-text-color)]">{{
                      goodreadsSkippedIssueCount
                    }}</strong>
                    · Pending:
                    <strong class="text-[var(--p-text-color)]">{{
                      goodreadsPendingIssueCount
                    }}</strong>
                  </span>
                </div>
                <Card
                  v-for="issue in goodreadsImportIssues"
                  :key="issue.issueKey"
                  class="mt-2"
                  :dt="{
                    shadow: 'none',
                    body: { padding: '1rem', gap: '0.75rem' },
                    title: { fontSize: '0.875rem' },
                  }"
                >
                  <template #title>
                    <div class="flex items-start justify-between gap-2">
                      <span>{{ goodreadsIssueDescription(issue) }}</span>
                      <Tag
                        v-if="issue.resolution !== 'pending'"
                        :severity="goodreadsIssueResolutionSeverity(issue.resolution)"
                        rounded
                        class="shrink-0"
                      >
                        {{ goodreadsIssueResolutionLabel(issue.resolution) }}
                      </Tag>
                    </div>
                  </template>
                  <template #subtitle>Row {{ issue.row_number }} in your CSV</template>
                  <template #content>
                    <div v-if="issue.isEditing">
                      <InputText
                        :model-value="issue.value"
                        :placeholder="issue.placeholder"
                        class="w-full"
                        data-test="goodreads-import-issue-input"
                        @update:model-value="onGoodreadsIssueValueInput(issue, $event)"
                      />
                    </div>
                    <Message
                      v-else-if="issue.suggested_value"
                      severity="info"
                      size="small"
                      variant="simple"
                      :closable="false"
                    >
                      <p class="m-0 text-sm font-medium break-words">
                        {{ issue.suggested_value }}
                      </p>
                      <p
                        v-if="goodreadsSuggestionConfidenceText(issue)"
                        class="m-0 mt-1 text-xs text-[var(--p-text-muted-color)]"
                      >
                        {{ goodreadsSuggestionConfidenceText(issue) }}
                      </p>
                    </Message>
                    <Message
                      v-else
                      severity="secondary"
                      size="small"
                      variant="simple"
                      :closable="false"
                    >
                      No suggestion available
                    </Message>
                  </template>
                  <template #footer>
                    <div class="flex flex-wrap gap-1">
                      <Button
                        v-if="issue.suggested_value && issue.resolution !== 'resolved'"
                        label="Use suggestion"
                        size="small"
                        outlined
                        data-test="goodreads-import-issue-use-suggestion"
                        @click="applyGoodreadsSuggestion(issue)"
                      />
                      <Button
                        v-if="!issue.isEditing && issue.resolution !== 'resolved'"
                        label="Edit"
                        size="small"
                        text
                        severity="secondary"
                        data-test="goodreads-import-issue-modify"
                        @click="startGoodreadsIssueEdit(issue)"
                      />
                      <Button
                        v-if="issue.resolution !== 'skipped'"
                        label="Skip"
                        size="small"
                        text
                        severity="secondary"
                        data-test="goodreads-import-issue-mark-skip"
                        @click="markGoodreadsIssueSkipped(issue)"
                      />
                      <Button
                        v-else
                        label="Undo skip"
                        size="small"
                        severity="secondary"
                        text
                        data-test="goodreads-import-issue-undo-skip"
                        @click="undoGoodreadsIssueSkip(issue)"
                      />
                      <Button
                        v-if="issue.isEditing"
                        label="Done"
                        size="small"
                        severity="secondary"
                        text
                        data-test="goodreads-import-issue-done"
                        @click="finishGoodreadsIssueEdit(issue)"
                      />
                    </div>
                  </template>
                </Card>
              </Panel>

              <Message
                v-if="goodreadsImportError"
                severity="error"
                :closable="false"
                data-test="goodreads-import-error"
              >
                {{ goodreadsImportError }}
              </Message>

              <div
                v-if="goodreadsImportJob"
                class="rounded border border-[var(--p-content-border-color)] p-3"
              >
                <p class="m-0 text-sm font-medium" data-test="goodreads-import-status">
                  Status: {{ goodreadsImportJob.status }}
                </p>
                <p
                  class="m-0 text-xs text-[var(--p-text-muted-color)]"
                  data-test="goodreads-import-counts"
                >
                  Processed {{ goodreadsImportJob.processed_rows }} /
                  {{ goodreadsImportJob.total_rows }} (imported
                  {{ goodreadsImportJob.imported_rows }}, failed
                  {{ goodreadsImportJob.failed_rows }}, skipped
                  {{ goodreadsImportJob.skipped_rows }})
                </p>
                <p
                  v-if="goodreadsImportJob.error_summary"
                  class="m-0 text-xs text-[var(--p-text-muted-color)]"
                  data-test="goodreads-import-error-summary"
                >
                  {{ goodreadsImportJob.error_summary }}
                </p>

                <div
                  v-if="goodreadsImportJob.rows_preview?.length"
                  class="mt-2 space-y-1"
                  data-test="goodreads-import-preview"
                >
                  <p class="m-0 text-xs font-semibold">Failed / skipped rows</p>
                  <div
                    v-for="row in goodreadsImportJob.rows_preview"
                    :key="`row-${row.row_number}`"
                    class="text-xs"
                    data-test="goodreads-import-preview-row"
                  >
                    Row {{ row.row_number }}: {{ row.message }}
                  </div>
                </div>
              </div>
            </div>
          </template>
        </Card>

        <div class="flex justify-end">
          <Button
            :disabled="saving || loading"
            :label="saving ? 'Saving...' : 'Save settings'"
            data-test="settings-save"
            @click="save"
          />
        </div>
      </div>
    </template>
  </Card>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import Badge from 'primevue/badge';
import Button from 'primevue/button';
import Card from 'primevue/card';
import InputText from 'primevue/inputtext';
import Message from 'primevue/message';
import Panel from 'primevue/panel';
import Tag from 'primevue/tag';
import { useToast } from 'primevue/usetoast';
import { ApiClientError, apiRequest } from '~/utils/api';

definePageMeta({ layout: 'app', middleware: 'auth' });

type MeProfile = {
  handle: string;
  display_name: string | null;
  avatar_url: string | null;
  enable_google_books: boolean;
  default_progress_unit: 'pages_read' | 'percent_complete' | 'minutes_listened';
};

type ImportPreviewRow = {
  row_number: number;
  title: string | null;
  uid: string | null;
  result: 'imported' | 'failed' | 'skipped';
  message: string;
};

type ImportJob = {
  job_id: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  total_rows: number;
  processed_rows: number;
  imported_rows: number;
  failed_rows: number;
  skipped_rows: number;
  error_summary: string | null;
  rows_preview: ImportPreviewRow[];
};

type ImportIssueCode = 'missing_authors' | 'missing_title' | 'missing_read_status';

type MissingRequiredRow = {
  row_number: number;
  field: 'title' | 'authors' | 'read_status';
  issue_code: ImportIssueCode;
  required: boolean;
  title: string | null;
  uid: string | null;
  suggested_value: string | null;
  suggestion_source: string | null;
  suggestion_confidence: 'high' | 'medium' | null;
};

type ImportIssue = MissingRequiredRow & {
  issueKey: string;
  value: string;
  fieldLabel: string;
  placeholder: string;
  resolution: 'pending' | 'resolved' | 'skipped';
  skipReasonCode: ImportIssueCode;
  isEditing: boolean;
};

const loading = ref(false);
const saving = ref(false);
const saved = ref(false);
const error = ref('');

const handle = ref('');
const displayName = ref('');
const avatarUrl = ref('');
const enableGoogleBooks = ref(false);
const defaultProgressUnit = ref<'pages_read' | 'percent_complete' | 'minutes_listened'>(
  'pages_read',
);

const importing = ref(false);
const importError = ref('');
const storygraphFile = ref<File | null>(null);
const storygraphFileInput = ref<HTMLInputElement | null>(null);
const importIssues = ref<ImportIssue[]>([]);
const importJob = ref<ImportJob | null>(null);
const issuesLoading = ref(false);
const issuesLoaded = ref(false);
const issuesLoadError = ref('');
const pendingIssueCount = computed(
  () => importIssues.value.filter((issue) => issue.resolution === 'pending').length,
);
const resolvedIssueCount = computed(
  () => importIssues.value.filter((issue) => issue.resolution === 'resolved').length,
);
const skippedIssueCount = computed(
  () => importIssues.value.filter((issue) => issue.resolution === 'skipped').length,
);
const toast = useToast();
const issuesStepSeverity = computed(() => {
  if (!storygraphFile.value) return 'secondary';
  if (issuesLoading.value) return 'info';
  if (issuesLoadError.value) return 'danger';
  if (!issuesLoaded.value) return 'secondary';
  return pendingIssueCount.value > 0 ? 'warn' : 'success';
});
const canStartImport = computed(
  () =>
    Boolean(storygraphFile.value) &&
    !issuesLoading.value &&
    issuesLoaded.value &&
    !issuesLoadError.value &&
    pendingIssueCount.value === 0 &&
    !importing.value,
);
const startDisabledReason = computed(() => {
  if (!storygraphFile.value) return 'Select a CSV file to begin.';
  if (issuesLoading.value) return 'Checking required fields in your CSV...';
  if (issuesLoadError.value) return 'Fix the issue check error and retry before importing.';
  if (!issuesLoaded.value) return 'Issue check has not completed yet.';
  if (pendingIssueCount.value > 0) {
    return `Resolve or skip ${pendingIssueCount.value} pending issue${
      pendingIssueCount.value === 1 ? '' : 's'
    } to continue.`;
  }
  return '';
});
let pollTimer: ReturnType<typeof setTimeout> | null = null;

const goodreadsImporting = ref(false);
const goodreadsImportError = ref('');
const goodreadsFile = ref<File | null>(null);
const goodreadsFileInput = ref<HTMLInputElement | null>(null);
const goodreadsImportIssues = ref<ImportIssue[]>([]);
const goodreadsImportJob = ref<ImportJob | null>(null);
const goodreadsIssuesLoading = ref(false);
const goodreadsIssuesLoaded = ref(false);
const goodreadsIssuesLoadError = ref('');
const goodreadsPendingIssueCount = computed(
  () => goodreadsImportIssues.value.filter((issue) => issue.resolution === 'pending').length,
);
const goodreadsResolvedIssueCount = computed(
  () => goodreadsImportIssues.value.filter((issue) => issue.resolution === 'resolved').length,
);
const goodreadsSkippedIssueCount = computed(
  () => goodreadsImportIssues.value.filter((issue) => issue.resolution === 'skipped').length,
);
const goodreadsIssuesStepSeverity = computed(() => {
  if (!goodreadsFile.value) return 'secondary';
  if (goodreadsIssuesLoading.value) return 'info';
  if (goodreadsIssuesLoadError.value) return 'danger';
  if (!goodreadsIssuesLoaded.value) return 'secondary';
  return goodreadsPendingIssueCount.value > 0 ? 'warn' : 'success';
});
const canStartGoodreadsImport = computed(
  () =>
    Boolean(goodreadsFile.value) &&
    !goodreadsIssuesLoading.value &&
    goodreadsIssuesLoaded.value &&
    !goodreadsIssuesLoadError.value &&
    goodreadsPendingIssueCount.value === 0 &&
    !goodreadsImporting.value,
);
const goodreadsStartDisabledReason = computed(() => {
  if (!goodreadsFile.value) return 'Select a CSV file to begin.';
  if (goodreadsIssuesLoading.value) return 'Checking required fields in your CSV...';
  if (goodreadsIssuesLoadError.value) {
    return 'Fix the issue check error and retry before importing.';
  }
  if (!goodreadsIssuesLoaded.value) return 'Issue check has not completed yet.';
  if (goodreadsPendingIssueCount.value > 0) {
    return `Resolve or skip ${goodreadsPendingIssueCount.value} pending issue${
      goodreadsPendingIssueCount.value === 1 ? '' : 's'
    } to continue.`;
  }
  return '';
});
let goodreadsPollTimer: ReturnType<typeof setTimeout> | null = null;

const clearPollTimer = () => {
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
};

const clearGoodreadsPollTimer = () => {
  if (goodreadsPollTimer) {
    clearTimeout(goodreadsPollTimer);
    goodreadsPollTimer = null;
  }
};

const loadProfile = async () => {
  loading.value = true;
  error.value = '';
  try {
    const data = await apiRequest<MeProfile>('/api/v1/me');
    handle.value = data.handle;
    displayName.value = data.display_name ?? '';
    avatarUrl.value = data.avatar_url ?? '';
    enableGoogleBooks.value = Boolean(data.enable_google_books);
    defaultProgressUnit.value = data.default_progress_unit || 'pages_read';
  } catch (err) {
    error.value = err instanceof ApiClientError ? err.message : 'Unable to load settings.';
  } finally {
    loading.value = false;
  }
};

const save = async () => {
  saving.value = true;
  saved.value = false;
  error.value = '';
  try {
    await apiRequest('/api/v1/me', {
      method: 'PATCH',
      body: {
        handle: handle.value,
        display_name: displayName.value,
        avatar_url: avatarUrl.value,
        enable_google_books: enableGoogleBooks.value,
        default_progress_unit: defaultProgressUnit.value,
      },
    });
    saved.value = true;
  } catch (err) {
    error.value = err instanceof ApiClientError ? err.message : 'Unable to save settings.';
  } finally {
    saving.value = false;
  }
};

const resetIssueState = () => {
  importIssues.value = [];
  issuesLoaded.value = false;
  issuesLoading.value = false;
  issuesLoadError.value = '';
};

const clearStorygraphSelection = () => {
  if (storygraphFileInput.value) storygraphFileInput.value.value = '';
  storygraphFile.value = null;
  importError.value = '';
  importJob.value = null;
  resetIssueState();
};

const openStorygraphPicker = () => {
  storygraphFileInput.value?.click();
};

const onStorygraphFileChange = (event: Event) => {
  const input = event.target as HTMLInputElement;
  storygraphFile.value = input.files?.[0] ?? null;
  importError.value = '';
  importJob.value = null;
  resetIssueState();
  if (storygraphFile.value) {
    void loadImportIssues(storygraphFile.value);
  }
};

const fieldLabel = (field: MissingRequiredRow['field']) => {
  if (field === 'authors') return 'Authors';
  if (field === 'title') return 'Title';
  return 'Read status';
};

const fieldPlaceholder = (field: MissingRequiredRow['field']) => {
  if (field === 'authors') return 'Author name(s), comma-separated';
  if (field === 'title') return 'Book title';
  return 'read | to-read | currently-reading | paused | did-not-finish';
};

const issueResolutionLabel = (resolution: ImportIssue['resolution']) => {
  if (resolution === 'resolved') return 'Resolved';
  if (resolution === 'skipped') return 'Skipped';
  return 'Pending';
};

const issueResolutionSeverity = (resolution: ImportIssue['resolution']) => {
  if (resolution === 'resolved') return 'success';
  if (resolution === 'skipped') return 'warn';
  return 'secondary';
};

const issueDescription = (issue: ImportIssue): string => {
  const fieldName = issue.fieldLabel.toLowerCase();
  const book = issue.title
    ? `\u201c${issue.title}\u201d`
    : issue.uid
      ? `ISBN ${issue.uid}`
      : 'an unknown book';
  return `Missing ${fieldName} for ${book}`;
};

const suggestionConfidenceText = (issue: ImportIssue): string => {
  const sourceMap: Record<string, string> = {
    'openlibrary:isbn': 'matched by ISBN on Open Library',
    'googlebooks:isbn': 'matched by ISBN on Google Books',
    'openlibrary:search': 'matched by title on Open Library',
    'googlebooks:search': 'matched by title on Google Books',
  };
  const confMap: Record<string, string> = {
    high: 'High confidence',
    medium: 'Moderate confidence',
  };
  const conf = issue.suggestion_confidence
    ? (confMap[issue.suggestion_confidence] ?? issue.suggestion_confidence)
    : '';
  const src = issue.suggestion_source
    ? (sourceMap[issue.suggestion_source] ?? issue.suggestion_source)
    : '';
  if (conf && src) return `${conf} \u2014 ${src}`;
  return conf || src || '';
};

const loadImportIssues = async (file: File) => {
  issuesLoading.value = true;
  issuesLoadError.value = '';
  const formData = new FormData();
  formData.append('file', file);
  try {
    const response = await apiRequest<{ items: MissingRequiredRow[] }>(
      '/api/v1/imports/storygraph/missing-authors',
      {
        method: 'POST',
        body: formData,
      },
    );
    importIssues.value = response.items.map((row) => {
      const value = '';
      return {
        ...row,
        issueKey: `${row.row_number}:${row.field}`,
        value,
        fieldLabel: fieldLabel(row.field),
        placeholder: fieldPlaceholder(row.field),
        resolution: 'pending',
        skipReasonCode: row.issue_code,
        isEditing: !row.suggested_value,
      };
    });
    issuesLoaded.value = true;
  } catch (err) {
    issuesLoaded.value = false;
    issuesLoadError.value =
      err instanceof ApiClientError
        ? err.message
        : 'Unable to load import issues from StoryGraph export.';
  } finally {
    issuesLoading.value = false;
  }
};

const retryLoadImportIssues = async () => {
  if (!storygraphFile.value) return;
  await loadImportIssues(storygraphFile.value);
};

const onIssueValueInput = (issue: ImportIssue, nextValue: string) => {
  issue.value = nextValue;
  const trimmed = nextValue.trim();
  issue.resolution = trimmed ? 'resolved' : 'pending';
  issue.isEditing = true;
};

const applySuggestion = (issue: ImportIssue) => {
  if (!issue.suggested_value) return;
  issue.value = issue.suggested_value;
  issue.resolution = 'resolved';
  issue.isEditing = false;
  toast.add({
    severity: 'success',
    summary: 'Suggestion applied',
    detail: `Applied suggestion to row ${issue.row_number}.`,
    life: 2200,
  });
};

const markIssueSkipped = (issue: ImportIssue) => {
  issue.resolution = 'skipped';
  issue.isEditing = false;
  toast.add({
    severity: 'warn',
    summary: 'Row skipped',
    detail: `Row ${issue.row_number} will be skipped.`,
    life: 2200,
  });
};

const undoIssueSkip = (issue: ImportIssue) => {
  issue.resolution = issue.value.trim() ? 'resolved' : 'pending';
  if (!issue.value.trim() && !issue.suggested_value) issue.isEditing = true;
  toast.add({
    severity: 'info',
    summary: 'Skip removed',
    detail: `Row ${issue.row_number} is no longer skipped.`,
    life: 2200,
  });
};

const startIssueEdit = (issue: ImportIssue) => {
  issue.isEditing = true;
  if (!issue.value.trim() && issue.suggested_value) {
    issue.value = issue.suggested_value;
  }
  issue.resolution = issue.value.trim() ? 'resolved' : 'pending';
};

const finishIssueEdit = (issue: ImportIssue) => {
  issue.isEditing = false;
  issue.resolution = issue.value.trim() ? 'resolved' : 'pending';
};

/* c8 ignore start */
const pollImportStatus = async (jobId: string) => {
  try {
    const data = await apiRequest<ImportJob>(`/api/v1/imports/storygraph/${jobId}`);
    importJob.value = data;
    if (data.status === 'queued' || data.status === 'running') {
      pollTimer = setTimeout(() => {
        void pollImportStatus(jobId);
      }, 1000);
      return;
    }
    importing.value = false;
  } catch (err) {
    importing.value = false;
    importError.value =
      err instanceof ApiClientError ? err.message : 'Unable to fetch import status.';
  }
};

const startStorygraphImport = async () => {
  if (!canStartImport.value || !storygraphFile.value) return;
  importing.value = true;
  importError.value = '';
  importJob.value = null;
  clearPollTimer();

  try {
    if (!issuesLoaded.value && !issuesLoading.value) {
      await loadImportIssues(storygraphFile.value);
    }
    if (!issuesLoaded.value || issuesLoadError.value || pendingIssueCount.value > 0) {
      throw new Error('Import prerequisites are not complete.');
    }

    const authorOverrides: Record<string, string> = {};
    const titleOverrides: Record<string, string> = {};
    const statusOverrides: Record<string, string> = {};
    const skippedRows: number[] = [];
    const skipReasons: Record<string, string> = {};
    for (const issue of importIssues.value) {
      if (issue.resolution === 'skipped') {
        skippedRows.push(issue.row_number);
        skipReasons[String(issue.row_number)] = issue.skipReasonCode;
        continue;
      }
      const value = issue.value.trim();
      if (!value) continue;
      const key = String(issue.row_number);
      if (issue.field === 'authors') authorOverrides[key] = value;
      if (issue.field === 'title') titleOverrides[key] = value;
      if (issue.field === 'read_status') statusOverrides[key] = value;
    }

    const formData = new FormData();
    formData.append('file', storygraphFile.value);
    if (Object.keys(authorOverrides).length > 0) {
      formData.append('author_overrides', JSON.stringify(authorOverrides));
    }
    if (Object.keys(titleOverrides).length > 0) {
      formData.append('title_overrides', JSON.stringify(titleOverrides));
    }
    if (Object.keys(statusOverrides).length > 0) {
      formData.append('status_overrides', JSON.stringify(statusOverrides));
    }
    if (skippedRows.length > 0) {
      formData.append('skipped_rows', JSON.stringify(skippedRows));
      formData.append('skip_reasons', JSON.stringify(skipReasons));
    }

    const created = await apiRequest<{
      job_id: string;
      status: string;
      total_rows: number;
      processed_rows: number;
      imported_rows: number;
      failed_rows: number;
      skipped_rows: number;
      created_at: string;
    }>('/api/v1/imports/storygraph', {
      method: 'POST',
      body: formData,
    });

    importJob.value = {
      job_id: created.job_id,
      status: created.status as ImportJob['status'],
      total_rows: created.total_rows,
      processed_rows: created.processed_rows,
      imported_rows: created.imported_rows,
      failed_rows: created.failed_rows,
      skipped_rows: created.skipped_rows,
      error_summary: null,
      rows_preview: [],
    };

    await pollImportStatus(created.job_id);
  } catch (err) {
    importing.value = false;
    importError.value = err instanceof ApiClientError ? err.message : 'Unable to start import.';
  }
};
/* c8 ignore stop */

const resetGoodreadsIssueState = () => {
  goodreadsImportIssues.value = [];
  goodreadsIssuesLoaded.value = false;
  goodreadsIssuesLoading.value = false;
  goodreadsIssuesLoadError.value = '';
};

const clearGoodreadsSelection = () => {
  if (goodreadsFileInput.value) goodreadsFileInput.value.value = '';
  goodreadsFile.value = null;
  goodreadsImportError.value = '';
  goodreadsImportJob.value = null;
  resetGoodreadsIssueState();
};

const openGoodreadsPicker = () => {
  goodreadsFileInput.value?.click();
};

const onGoodreadsFileChange = (event: Event) => {
  const input = event.target as HTMLInputElement;
  goodreadsFile.value = input.files?.[0] ?? null;
  goodreadsImportError.value = '';
  goodreadsImportJob.value = null;
  resetGoodreadsIssueState();
  if (goodreadsFile.value) {
    void loadGoodreadsImportIssues(goodreadsFile.value);
  }
};

const goodreadsFieldLabel = (field: MissingRequiredRow['field']) => {
  if (field === 'authors') return 'Authors';
  if (field === 'title') return 'Title';
  return 'Read status';
};

const goodreadsFieldPlaceholder = (field: MissingRequiredRow['field']) => {
  if (field === 'authors') return 'Author name(s), comma-separated';
  if (field === 'title') return 'Book title';
  return 'read | to-read | currently-reading | paused | did-not-finish';
};

const goodreadsIssueResolutionLabel = (resolution: ImportIssue['resolution']) => {
  if (resolution === 'resolved') return 'Resolved';
  if (resolution === 'skipped') return 'Skipped';
  return 'Pending';
};

const goodreadsIssueResolutionSeverity = (resolution: ImportIssue['resolution']) => {
  if (resolution === 'resolved') return 'success';
  if (resolution === 'skipped') return 'warn';
  return 'secondary';
};

const goodreadsIssueDescription = (issue: ImportIssue): string => {
  const fieldName = issue.fieldLabel.toLowerCase();
  const book = issue.title
    ? `\u201c${issue.title}\u201d`
    : issue.uid
      ? `ISBN ${issue.uid}`
      : 'an unknown book';
  return `Missing ${fieldName} for ${book}`;
};

const goodreadsSuggestionConfidenceText = (issue: ImportIssue): string => {
  const sourceMap: Record<string, string> = {
    'openlibrary:isbn': 'matched by ISBN on Open Library',
    'googlebooks:isbn': 'matched by ISBN on Google Books',
    'openlibrary:search': 'matched by title on Open Library',
    'googlebooks:search': 'matched by title on Google Books',
  };
  const confMap: Record<string, string> = {
    high: 'High confidence',
    medium: 'Moderate confidence',
  };
  const conf = issue.suggestion_confidence
    ? (confMap[issue.suggestion_confidence] ?? issue.suggestion_confidence)
    : '';
  const src = issue.suggestion_source
    ? (sourceMap[issue.suggestion_source] ?? issue.suggestion_source)
    : '';
  if (conf && src) return `${conf} \u2014 ${src}`;
  return conf || src || '';
};

const loadGoodreadsImportIssues = async (file: File) => {
  goodreadsIssuesLoading.value = true;
  goodreadsIssuesLoadError.value = '';
  const formData = new FormData();
  formData.append('file', file);
  try {
    const response = await apiRequest<{ items: MissingRequiredRow[] }>(
      '/api/v1/imports/goodreads/missing-required',
      {
        method: 'POST',
        body: formData,
      },
    );
    goodreadsImportIssues.value = response.items.map((row) => {
      const value = '';
      return {
        ...row,
        issueKey: `${row.row_number}:${row.field}`,
        value,
        fieldLabel: goodreadsFieldLabel(row.field),
        placeholder: goodreadsFieldPlaceholder(row.field),
        resolution: 'pending',
        skipReasonCode: row.issue_code,
        isEditing: !row.suggested_value,
      };
    });
    goodreadsIssuesLoaded.value = true;
  } catch (err) {
    goodreadsIssuesLoaded.value = false;
    goodreadsIssuesLoadError.value =
      err instanceof ApiClientError
        ? err.message
        : 'Unable to load import issues from Goodreads export.';
  } finally {
    goodreadsIssuesLoading.value = false;
  }
};

const retryLoadGoodreadsImportIssues = async () => {
  if (!goodreadsFile.value) return;
  await loadGoodreadsImportIssues(goodreadsFile.value);
};

const onGoodreadsIssueValueInput = (issue: ImportIssue, nextValue: string) => {
  issue.value = nextValue;
  const trimmed = nextValue.trim();
  issue.resolution = trimmed ? 'resolved' : 'pending';
  issue.isEditing = true;
};

const applyGoodreadsSuggestion = (issue: ImportIssue) => {
  if (!issue.suggested_value) return;
  issue.value = issue.suggested_value;
  issue.resolution = 'resolved';
  issue.isEditing = false;
  toast.add({
    severity: 'success',
    summary: 'Suggestion applied',
    detail: `Applied suggestion to row ${issue.row_number}.`,
    life: 2200,
  });
};

const markGoodreadsIssueSkipped = (issue: ImportIssue) => {
  issue.resolution = 'skipped';
  issue.isEditing = false;
  toast.add({
    severity: 'warn',
    summary: 'Row skipped',
    detail: `Row ${issue.row_number} will be skipped.`,
    life: 2200,
  });
};

const undoGoodreadsIssueSkip = (issue: ImportIssue) => {
  issue.resolution = issue.value.trim() ? 'resolved' : 'pending';
  if (!issue.value.trim() && !issue.suggested_value) issue.isEditing = true;
  toast.add({
    severity: 'info',
    summary: 'Skip removed',
    detail: `Row ${issue.row_number} is no longer skipped.`,
    life: 2200,
  });
};

const startGoodreadsIssueEdit = (issue: ImportIssue) => {
  issue.isEditing = true;
  if (!issue.value.trim() && issue.suggested_value) {
    issue.value = issue.suggested_value;
  }
  issue.resolution = issue.value.trim() ? 'resolved' : 'pending';
};

const finishGoodreadsIssueEdit = (issue: ImportIssue) => {
  issue.isEditing = false;
  issue.resolution = issue.value.trim() ? 'resolved' : 'pending';
};

/* c8 ignore start */
const pollGoodreadsImportStatus = async (jobId: string) => {
  try {
    const data = await apiRequest<ImportJob>(`/api/v1/imports/goodreads/${jobId}`);
    goodreadsImportJob.value = data;
    if (data.status === 'queued' || data.status === 'running') {
      goodreadsPollTimer = setTimeout(() => {
        void pollGoodreadsImportStatus(jobId);
      }, 1000);
      return;
    }
    goodreadsImporting.value = false;
  } catch (err) {
    goodreadsImporting.value = false;
    goodreadsImportError.value =
      err instanceof ApiClientError ? err.message : 'Unable to fetch import status.';
  }
};

const startGoodreadsImport = async () => {
  if (!canStartGoodreadsImport.value || !goodreadsFile.value) return;
  goodreadsImporting.value = true;
  goodreadsImportError.value = '';
  goodreadsImportJob.value = null;
  clearGoodreadsPollTimer();

  try {
    if (!goodreadsIssuesLoaded.value && !goodreadsIssuesLoading.value) {
      await loadGoodreadsImportIssues(goodreadsFile.value);
    }
    if (
      !goodreadsIssuesLoaded.value ||
      goodreadsIssuesLoadError.value ||
      goodreadsPendingIssueCount.value > 0
    ) {
      throw new Error('Import prerequisites are not complete.');
    }

    const authorOverrides: Record<string, string> = {};
    const titleOverrides: Record<string, string> = {};
    const shelfOverrides: Record<string, string> = {};
    const skippedRows: number[] = [];
    const skipReasons: Record<string, string> = {};
    for (const issue of goodreadsImportIssues.value) {
      if (issue.resolution === 'skipped') {
        skippedRows.push(issue.row_number);
        skipReasons[String(issue.row_number)] = issue.skipReasonCode;
        continue;
      }
      const value = issue.value.trim();
      if (!value) continue;
      const key = String(issue.row_number);
      if (issue.field === 'authors') authorOverrides[key] = value;
      if (issue.field === 'title') titleOverrides[key] = value;
      if (issue.field === 'read_status') shelfOverrides[key] = value;
    }

    const formData = new FormData();
    formData.append('file', goodreadsFile.value);
    if (Object.keys(authorOverrides).length > 0) {
      formData.append('author_overrides', JSON.stringify(authorOverrides));
    }
    if (Object.keys(titleOverrides).length > 0) {
      formData.append('title_overrides', JSON.stringify(titleOverrides));
    }
    if (Object.keys(shelfOverrides).length > 0) {
      formData.append('shelf_overrides', JSON.stringify(shelfOverrides));
    }
    if (skippedRows.length > 0) {
      formData.append('skipped_rows', JSON.stringify(skippedRows));
      formData.append('skip_reasons', JSON.stringify(skipReasons));
    }

    const created = await apiRequest<{
      job_id: string;
      status: string;
      total_rows: number;
      processed_rows: number;
      imported_rows: number;
      failed_rows: number;
      skipped_rows: number;
      created_at: string;
    }>('/api/v1/imports/goodreads', {
      method: 'POST',
      body: formData,
    });

    goodreadsImportJob.value = {
      job_id: created.job_id,
      status: created.status as ImportJob['status'],
      total_rows: created.total_rows,
      processed_rows: created.processed_rows,
      imported_rows: created.imported_rows,
      failed_rows: created.failed_rows,
      skipped_rows: created.skipped_rows,
      error_summary: null,
      rows_preview: [],
    };

    await pollGoodreadsImportStatus(created.job_id);
  } catch (err) {
    goodreadsImporting.value = false;
    goodreadsImportError.value =
      err instanceof ApiClientError ? err.message : 'Unable to start import.';
  }
};
/* c8 ignore stop */
onMounted(() => {
  void loadProfile();
});

onBeforeUnmount(() => {
  clearPollTimer();
  clearGoodreadsPollTimer();
});
</script>

<style scoped>
.storygraph-import-card {
  overflow-x: hidden;
}

.storygraph-import-card :deep(.p-card-content),
.storygraph-issues-panel :deep(.p-panel-content),
.goodreads-import-card :deep(.p-card-content),
.goodreads-issues-panel :deep(.p-panel-content) {
  min-width: 0;
  overflow-x: hidden;
}
</style>
