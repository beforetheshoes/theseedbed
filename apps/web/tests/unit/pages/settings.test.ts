import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { mount } from '@vue/test-utils';
import PrimeVue from 'primevue/config';

const apiRequest = vi.hoisted(() => vi.fn());
const toastAdd = vi.hoisted(() => vi.fn());
const ApiClientErrorMock = vi.hoisted(
  () =>
    class ApiClientError extends Error {
      code: string;
      status?: number;

      constructor(message: string, code: string, status?: number) {
        super(message);
        this.code = code;
        this.status = status;
      }
    },
);

vi.mock('~/utils/api', () => ({
  apiRequest,
  ApiClientError: ApiClientErrorMock,
}));

vi.mock('primevue/usetoast', () => ({
  useToast: () => ({ add: toastAdd }),
}));

import SettingsPage from '../../../app/pages/settings.vue';

const ButtonStub = defineComponent({
  name: 'Button',
  emits: ['click'],
  setup:
    (_props, { attrs, slots, emit }) =>
    () =>
      h(
        'button',
        {
          ...attrs,
          disabled: attrs.disabled,
          onClick: (e: unknown) => emit('click', e),
        },
        slots.default?.() ?? attrs['label'] ?? '',
      ),
});

const InputTextStub = defineComponent({
  name: 'InputText',
  props: ['modelValue'],
  emits: ['update:modelValue'],
  setup:
    (props, { attrs, emit }) =>
    () =>
      h('input', {
        ...attrs,
        value: props.modelValue ?? '',
        onInput: (e: Event) => emit('update:modelValue', (e.target as HTMLInputElement).value),
      }),
});

const CardStub = defineComponent({
  name: 'Card',
  setup:
    (_props, { slots, attrs }) =>
    () =>
      h('div', { ...attrs }, [
        slots.title?.(),
        slots.subtitle?.(),
        slots.content?.(),
        slots.footer?.(),
        slots.default?.(),
      ]),
});

const PanelStub = defineComponent({
  name: 'Panel',
  setup:
    (_props, { slots, attrs }) =>
    () =>
      h('section', { ...attrs }, [slots.header?.(), slots.default?.()]),
});

const MessageStub = defineComponent({
  name: 'Message',
  setup:
    (_props, { slots, attrs }) =>
    () =>
      h('div', { ...attrs }, slots.default?.()),
});

const TagStub = defineComponent({
  name: 'Tag',
  setup:
    (_props, { slots, attrs }) =>
    () =>
      h('span', { ...attrs }, slots.default?.() ?? attrs.value ?? ''),
});

const BadgeStub = defineComponent({
  name: 'Badge',
  setup:
    (_props, { attrs }) =>
    () =>
      h('span', { ...attrs }, attrs.value ?? ''),
});

const flush = async (wrapper: ReturnType<typeof mount>) => {
  await wrapper.vm.$nextTick();
  await Promise.resolve();
  await wrapper.vm.$nextTick();
};

const selectFile = async (wrapper: ReturnType<typeof mount>, file?: File) => {
  const fileInput = wrapper.get('[data-test="storygraph-file-input"]');
  Object.defineProperty(fileInput.element, 'files', {
    value: file ? [file] : [],
    configurable: true,
  });
  await fileInput.trigger('change');
};

const selectGoodreadsFile = async (wrapper: ReturnType<typeof mount>, file?: File) => {
  const fileInput = wrapper.get('[data-test="goodreads-file-input"]');
  Object.defineProperty(fileInput.element, 'files', {
    value: file ? [file] : [],
    configurable: true,
  });
  await fileInput.trigger('change');
};

const mountPage = () =>
  mount(SettingsPage, {
    global: {
      plugins: [[PrimeVue, { ripple: false }]],
      stubs: {
        Button: ButtonStub,
        InputText: InputTextStub,
        Card: CardStub,
        Message: MessageStub,
        Panel: PanelStub,
        Tag: TagStub,
        Badge: BadgeStub,
      },
    },
  });

const mockProfile = () => ({
  handle: 'seed',
  display_name: 'Seed',
  avatar_url: null,
  enable_google_books: false,
});

describe('settings page StoryGraph import UX', () => {
  beforeEach(() => {
    apiRequest.mockReset();
    toastAdd.mockReset();
  });

  it('keeps Start disabled while issues are loading', async () => {
    vi.useFakeTimers();
    apiRequest.mockImplementation((path: string) => {
      if (path === '/api/v1/me') return Promise.resolve(mockProfile());
      if (path === '/api/v1/imports/storygraph/missing-authors') {
        return new Promise((resolve) => setTimeout(() => resolve({ items: [] }), 50));
      }
      return Promise.resolve({});
    });

    const wrapper = mountPage();
    await flush(wrapper);

    const file = new File(['a,b\n'], 'storygraph.csv', { type: 'text/csv' });
    await selectFile(wrapper, file);
    await wrapper.vm.$nextTick();

    const startButton = wrapper.get('[data-test="storygraph-import-start"]');
    expect((startButton.element as HTMLButtonElement).disabled).toBe(true);
    expect(wrapper.get('[data-test="storygraph-issues-loading"]').text()).toContain('Checking CSV');

    await vi.runAllTimersAsync();
    await flush(wrapper);
    expect((startButton.element as HTMLButtonElement).disabled).toBe(false);
    vi.useRealTimers();
  });

  it('loads and saves profile settings', async () => {
    apiRequest.mockImplementation((path: string) => {
      if (path === '/api/v1/me') return Promise.resolve(mockProfile());
      return Promise.resolve({});
    });

    const wrapper = mountPage();
    await flush(wrapper);

    await wrapper.get('[data-test="settings-handle"]').setValue('new-handle');
    await wrapper.get('[data-test="settings-display-name"]').setValue('New Name');
    await wrapper.get('[data-test="settings-avatar-url"]').setValue('https://example.com/new.png');
    await wrapper.get('[data-test="settings-enable-google-books"]').setValue(true);
    await wrapper.get('[data-test="settings-save"]').trigger('click');
    await flush(wrapper);

    const patchCall = apiRequest.mock.calls.find((call) => call[0] === '/api/v1/me' && call[1]);
    expect(patchCall?.[1]).toMatchObject({
      method: 'PATCH',
      body: expect.objectContaining({ enable_google_books: true }),
    });
    expect(wrapper.get('[data-test="settings-saved"]').text()).toContain('Settings saved');
  });

  it('normalizes nullable profile fields', async () => {
    apiRequest.mockResolvedValueOnce({
      handle: 'seed',
      display_name: null,
      avatar_url: null,
      enable_google_books: false,
    });

    const wrapper = mountPage();
    await flush(wrapper);
    expect(
      (wrapper.get('[data-test="settings-display-name"]').element as HTMLInputElement).value,
    ).toBe('');
  });

  it('handles profile load and save error branches', async () => {
    apiRequest
      .mockRejectedValueOnce(new ApiClientErrorMock('No profile', 'bad_request', 400))
      .mockResolvedValueOnce(mockProfile())
      .mockRejectedValueOnce(new Error('boom'));

    const firstWrapper = mountPage();
    await flush(firstWrapper);
    expect(firstWrapper.get('[data-test="settings-error"]').text()).toContain('No profile');

    const secondWrapper = mountPage();
    await flush(secondWrapper);
    await secondWrapper.get('[data-test="settings-save"]').trigger('click');
    await flush(secondWrapper);
    expect(secondWrapper.get('[data-test="settings-error"]').text()).toContain(
      'Unable to save settings.',
    );
  });

  it('shows generic error when profile load fails without API details', async () => {
    apiRequest.mockRejectedValueOnce(new Error('boom'));

    const wrapper = mountPage();
    await flush(wrapper);
    expect(wrapper.get('[data-test="settings-error"]').text()).toContain(
      'Unable to load settings.',
    );
  });

  it('shows API message when save fails with ApiClientError', async () => {
    apiRequest
      .mockResolvedValueOnce(mockProfile())
      .mockRejectedValueOnce(new ApiClientErrorMock('Denied', 'denied', 403));

    const wrapper = mountPage();
    await flush(wrapper);
    await wrapper.get('[data-test="settings-save"]').trigger('click');
    await flush(wrapper);
    expect(wrapper.get('[data-test="settings-error"]').text()).toContain('Denied');
  });

  it('blocks Start until issues are resolved or skipped', async () => {
    apiRequest.mockImplementation((path: string) => {
      if (path === '/api/v1/me') return Promise.resolve(mockProfile());
      if (path === '/api/v1/imports/storygraph/missing-authors') {
        return Promise.resolve({
          items: [
            {
              row_number: 150,
              field: 'authors',
              issue_code: 'missing_authors',
              required: true,
              title: 'A Small Key',
              uid: '9781938660177',
              suggested_value: null,
              suggestion_source: null,
              suggestion_confidence: null,
            },
          ],
        });
      }
      return Promise.resolve({});
    });

    const wrapper = mountPage();
    await flush(wrapper);

    const file = new File(['a,b\n'], 'storygraph.csv', { type: 'text/csv' });
    await selectFile(wrapper, file);
    await flush(wrapper);

    const startButton = wrapper.get('[data-test="storygraph-import-start"]');
    expect((startButton.element as HTMLButtonElement).disabled).toBe(true);

    await wrapper.get('[data-test="storygraph-import-issue-mark-skip"]').trigger('click');
    await wrapper.vm.$nextTick();

    expect((startButton.element as HTMLButtonElement).disabled).toBe(false);
    expect(toastAdd).toHaveBeenCalledWith(expect.objectContaining({ summary: 'Row skipped' }));
  });

  it('applies suggestion with visible feedback and enables Start', async () => {
    apiRequest.mockImplementation((path: string) => {
      if (path === '/api/v1/me') return Promise.resolve(mockProfile());
      if (path === '/api/v1/imports/storygraph/missing-authors') {
        return Promise.resolve({
          items: [
            {
              row_number: 33,
              field: 'authors',
              issue_code: 'missing_authors',
              required: true,
              title: 'Book',
              uid: '9781938660177',
              suggested_value: 'Suggested Author',
              suggestion_source: 'openlibrary:isbn',
              suggestion_confidence: 'high',
            },
          ],
        });
      }
      return Promise.resolve({});
    });

    const wrapper = mountPage();
    await flush(wrapper);

    const file = new File(['a,b\n'], 'storygraph.csv', { type: 'text/csv' });
    await selectFile(wrapper, file);
    await flush(wrapper);

    await wrapper.get('[data-test="storygraph-import-issue-use-suggestion"]').trigger('click');
    await wrapper.vm.$nextTick();

    expect(
      (wrapper.get('[data-test="storygraph-import-start"]').element as HTMLButtonElement).disabled,
    ).toBe(false);
    expect(toastAdd).toHaveBeenCalledWith(
      expect.objectContaining({ summary: 'Suggestion applied' }),
    );
  });

  it('blocks import and supports retry when preflight fails', async () => {
    let shouldFail = true;
    apiRequest.mockImplementation((path: string) => {
      if (path === '/api/v1/me') return Promise.resolve(mockProfile());
      if (path === '/api/v1/imports/storygraph/missing-authors') {
        if (shouldFail) throw new ApiClientErrorMock('Bad preflight', 'bad_preflight', 400);
        return Promise.resolve({ items: [] });
      }
      return Promise.resolve({});
    });

    const wrapper = mountPage();
    await flush(wrapper);

    const file = new File(['a,b\n'], 'storygraph.csv', { type: 'text/csv' });
    await selectFile(wrapper, file);
    await flush(wrapper);

    expect(wrapper.get('[data-test="storygraph-import-issues-error"]').text()).toContain(
      'Bad preflight',
    );
    expect(
      (wrapper.get('[data-test="storygraph-import-start"]').element as HTMLButtonElement).disabled,
    ).toBe(true);

    shouldFail = false;
    await wrapper.get('[data-test="storygraph-import-issues-retry"]').trigger('click');
    await flush(wrapper);

    expect(wrapper.find('[data-test="storygraph-import-issues-error"]').exists()).toBe(false);
    expect(
      (wrapper.get('[data-test="storygraph-import-start"]').element as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it('handles generic preflight error and no-file selection', async () => {
    apiRequest.mockImplementation((path: string) => {
      if (path === '/api/v1/me') return Promise.resolve(mockProfile());
      if (path === '/api/v1/imports/storygraph/missing-authors') throw new Error('boom');
      return Promise.resolve({});
    });

    const wrapper = mountPage();
    await flush(wrapper);

    await selectFile(wrapper, new File(['a,b\n'], 'storygraph.csv', { type: 'text/csv' }));
    await flush(wrapper);
    expect(wrapper.get('[data-test="storygraph-import-issues-error"]').text()).toContain(
      'Unable to load import issues from StoryGraph export.',
    );

    await selectFile(wrapper);
    await wrapper.vm.$nextTick();
    expect(wrapper.get('[data-test="storygraph-start-disabled-reason"]').text()).toContain(
      'Select a CSV file',
    );
  });

  it('renders title/read-status issue variants and supports undo skip', async () => {
    apiRequest.mockImplementation((path: string) => {
      if (path === '/api/v1/me') return Promise.resolve(mockProfile());
      if (path === '/api/v1/imports/storygraph/missing-authors') {
        return Promise.resolve({
          items: [
            {
              row_number: 21,
              field: 'title',
              issue_code: 'missing_title',
              required: true,
              title: null,
              uid: '9781938660177',
              suggested_value: null,
              suggestion_source: null,
              suggestion_confidence: null,
            },
            {
              row_number: 22,
              field: 'read_status',
              issue_code: 'missing_read_status',
              required: true,
              title: 'Read Status Missing',
              uid: null,
              suggested_value: null,
              suggestion_source: null,
              suggestion_confidence: null,
            },
          ],
        });
      }
      return Promise.resolve({});
    });

    const wrapper = mountPage();
    await flush(wrapper);
    await selectFile(wrapper, new File(['a,b\n'], 'storygraph.csv', { type: 'text/csv' }));
    await flush(wrapper);

    const panelText = wrapper.get('[data-test="storygraph-import-issues"]').text();
    expect(panelText).toContain('Missing title');
    expect(panelText).toContain('Missing read status');

    const issueInputs = wrapper.findAll('[data-test="storygraph-import-issue-input"]');
    expect((issueInputs[1]?.element as HTMLInputElement).placeholder).toContain(
      'currently-reading',
    );

    const skipButtons = wrapper.findAll('[data-test="storygraph-import-issue-mark-skip"]');
    await skipButtons[0]?.trigger('click');
    await wrapper.vm.$nextTick();

    await wrapper.get('[data-test="storygraph-import-issue-undo-skip"]').trigger('click');
    await wrapper.vm.$nextTick();
    expect(toastAdd).toHaveBeenCalledWith(expect.objectContaining({ summary: 'Skip removed' }));
  });

  it('allows modify + done flow without auto-accepting suggestion', async () => {
    apiRequest.mockImplementation((path: string) => {
      if (path === '/api/v1/me') return Promise.resolve(mockProfile());
      if (path === '/api/v1/imports/storygraph/missing-authors') {
        return Promise.resolve({
          items: [
            {
              row_number: 40,
              field: 'authors',
              issue_code: 'missing_authors',
              required: true,
              title: 'Book',
              uid: '9781938660177',
              suggested_value: 'Suggested Author',
              suggestion_source: 'openlibrary:isbn',
              suggestion_confidence: 'high',
            },
          ],
        });
      }
      return Promise.resolve({});
    });

    const wrapper = mountPage();
    await flush(wrapper);
    await selectFile(wrapper, new File(['a,b\n'], 'storygraph.csv', { type: 'text/csv' }));
    await flush(wrapper);

    expect(
      (wrapper.get('[data-test="storygraph-import-start"]').element as HTMLButtonElement).disabled,
    ).toBe(true);

    await wrapper.get('[data-test="storygraph-import-issue-modify"]').trigger('click');
    await wrapper.vm.$nextTick();

    const issueInput = wrapper.get('[data-test="storygraph-import-issue-input"]');
    expect((issueInput.element as HTMLInputElement).value).toBe('Suggested Author');
    await issueInput.setValue('Manual Author');
    await wrapper.get('[data-test="storygraph-import-issue-done"]').trigger('click');
    await wrapper.vm.$nextTick();

    expect(
      (wrapper.get('[data-test="storygraph-import-start"]').element as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it('clears import state from clear button and unmounts safely', async () => {
    apiRequest.mockImplementation((path: string) => {
      if (path === '/api/v1/me') return Promise.resolve(mockProfile());
      if (path === '/api/v1/imports/storygraph/missing-authors')
        return Promise.resolve({ items: [] });
      return Promise.resolve({});
    });

    const wrapper = mountPage();
    await flush(wrapper);
    await selectFile(wrapper, new File(['a,b\n'], 'storygraph.csv', { type: 'text/csv' }));
    await flush(wrapper);

    await wrapper.get('[data-test="storygraph-file-clear"]').trigger('click');
    await flush(wrapper);
    expect(wrapper.get('[data-test="storygraph-start-disabled-reason"]').text()).toContain(
      'Select a CSV file',
    );

    wrapper.unmount();
  });

  it('covers retry/suggestion guard paths and resolved undo branch', async () => {
    apiRequest.mockResolvedValue(mockProfile());
    const wrapper = mountPage();
    await flush(wrapper);

    const setupState = (wrapper.vm as any).$?.setupState;
    expect(setupState).toBeTruthy();

    const beforeCalls = apiRequest.mock.calls.length;
    await setupState.retryLoadImportIssues();
    expect(apiRequest.mock.calls.length).toBe(beforeCalls);

    const noSuggestionIssue = {
      row_number: 7,
      suggested_value: null,
      value: '',
      resolution: 'pending',
      skipReasonCode: 'missing_authors',
    };
    setupState.applySuggestion(noSuggestionIssue);
    expect(toastAdd).not.toHaveBeenCalledWith(
      expect.objectContaining({ summary: 'Suggestion applied' }),
    );

    const resolvedUndoIssue = {
      row_number: 8,
      suggested_value: null,
      value: 'Author Name',
      resolution: 'skipped',
      skipReasonCode: 'missing_authors',
    };
    setupState.undoIssueSkip(resolvedUndoIssue);
    expect(resolvedUndoIssue.resolution).toBe('resolved');

    const editIssue = {
      row_number: 9,
      suggested_value: 'Suggested',
      value: 'Manual',
      resolution: 'pending',
      isEditing: false,
      skipReasonCode: 'missing_authors',
    };
    setupState.startIssueEdit(editIssue);
    expect(editIssue.value).toBe('Manual');
    expect(editIssue.resolution).toBe('resolved');
    editIssue.value = '';
    setupState.finishIssueEdit(editIssue);
    expect(editIssue.resolution).toBe('pending');

    setupState.storygraphFile = new File(['a,b\n'], 'storygraph.csv', { type: 'text/csv' });
    setupState.issuesLoading = false;
    setupState.issuesLoadError = '';
    setupState.issuesLoaded = false;
    expect(setupState.startDisabledReason).toContain('Issue check has not completed');

    const pendingInputIssue = {
      row_number: 10,
      suggested_value: null,
      value: '',
      resolution: 'resolved',
      isEditing: false,
      skipReasonCode: 'missing_authors',
    };
    setupState.onIssueValueInput(pendingInputIssue, '   ');
    expect(pendingInputIssue.resolution).toBe('pending');
  });

  it('covers picker click and label/confidence fallbacks', async () => {
    apiRequest.mockResolvedValue(mockProfile());
    const wrapper = mountPage();
    await flush(wrapper);

    const setupState = (wrapper.vm as any).$?.setupState;
    expect(setupState).toBeTruthy();

    let clicked = 0;
    setupState.storygraphFileInput = { click: () => clicked++ };
    setupState.openStorygraphPicker();
    expect(clicked).toBe(1);

    expect(setupState.issueResolutionLabel('pending')).toBe('Pending');
    expect(setupState.issueResolutionSeverity('pending')).toBe('secondary');

    const noSuggestion = {
      suggestion_confidence: null,
      suggestion_source: null,
    };
    expect(setupState.suggestionConfidenceText(noSuggestion)).toBe('');
  });

  it('shows import start API errors', async () => {
    apiRequest.mockImplementation((path: string) => {
      if (path === '/api/v1/me') return Promise.resolve(mockProfile());
      if (path === '/api/v1/imports/storygraph/missing-authors')
        return Promise.resolve({ items: [] });
      if (path === '/api/v1/imports/storygraph') {
        throw new ApiClientErrorMock('Bad CSV', 'bad_csv', 400);
      }
      return Promise.resolve({});
    });

    const wrapper = mountPage();
    await flush(wrapper);
    await selectFile(wrapper, new File(['a,b\n'], 'storygraph.csv', { type: 'text/csv' }));
    await flush(wrapper);

    await wrapper.get('[data-test="storygraph-import-start"]').trigger('click');
    await flush(wrapper);
    expect(wrapper.get('[data-test="storygraph-import-error"]').text()).toContain('Bad CSV');
  });

  it('renders job error summary and failed/skipped preview rows', async () => {
    apiRequest.mockImplementation((path: string) => {
      if (path === '/api/v1/me') return Promise.resolve(mockProfile());
      if (path === '/api/v1/imports/storygraph/missing-authors')
        return Promise.resolve({ items: [] });
      if (path === '/api/v1/imports/storygraph') {
        return Promise.resolve({
          job_id: 'job-preview',
          status: 'queued',
          total_rows: 0,
          processed_rows: 0,
          imported_rows: 0,
          failed_rows: 0,
          skipped_rows: 0,
          created_at: '2026-02-14T00:00:00Z',
        });
      }
      if (path === '/api/v1/imports/storygraph/job-preview') {
        return Promise.resolve({
          job_id: 'job-preview',
          status: 'completed',
          total_rows: 2,
          processed_rows: 2,
          imported_rows: 1,
          failed_rows: 1,
          skipped_rows: 0,
          error_summary: 'authors missing (1 rows)',
          rows_preview: [{ row_number: 150, result: 'failed', message: 'authors missing' }],
        });
      }
      return Promise.resolve({});
    });

    const wrapper = mountPage();
    await flush(wrapper);
    await selectFile(wrapper, new File(['a,b\n'], 'storygraph.csv', { type: 'text/csv' }));
    await flush(wrapper);

    await wrapper.get('[data-test="storygraph-import-start"]').trigger('click');
    await flush(wrapper);
    expect(wrapper.get('[data-test="storygraph-import-error-summary"]').text()).toContain(
      'authors missing',
    );
    expect(wrapper.get('[data-test="storygraph-import-preview"]').text()).toContain('Row 150');
  });

  it('clears polling timer when unmounting during running import', async () => {
    vi.useFakeTimers();
    apiRequest.mockImplementation((path: string) => {
      if (path === '/api/v1/me') return Promise.resolve(mockProfile());
      if (path === '/api/v1/imports/storygraph/missing-authors')
        return Promise.resolve({ items: [] });
      if (path === '/api/v1/imports/storygraph') {
        return Promise.resolve({
          job_id: 'job-running',
          status: 'queued',
          total_rows: 0,
          processed_rows: 0,
          imported_rows: 0,
          failed_rows: 0,
          skipped_rows: 0,
          created_at: '2026-02-14T00:00:00Z',
        });
      }
      if (path === '/api/v1/imports/storygraph/job-running') {
        return Promise.resolve({
          job_id: 'job-running',
          status: 'running',
          total_rows: 2,
          processed_rows: 1,
          imported_rows: 1,
          failed_rows: 0,
          skipped_rows: 0,
          error_summary: null,
          rows_preview: [],
        });
      }
      return Promise.resolve({});
    });

    const wrapper = mountPage();
    await flush(wrapper);
    await selectFile(wrapper, new File(['a,b\n'], 'storygraph.csv', { type: 'text/csv' }));
    await flush(wrapper);

    await wrapper.get('[data-test="storygraph-import-start"]').trigger('click');
    await flush(wrapper);
    await vi.runOnlyPendingTimersAsync();
    wrapper.unmount();
    vi.useRealTimers();
  });

  it('submits overrides and skipped rows in a single import request', async () => {
    apiRequest.mockImplementation((path: string) => {
      if (path === '/api/v1/me') return Promise.resolve(mockProfile());
      if (path === '/api/v1/imports/storygraph/missing-authors') {
        return Promise.resolve({
          items: [
            {
              row_number: 10,
              field: 'authors',
              issue_code: 'missing_authors',
              required: true,
              title: 'Book A',
              uid: null,
              suggested_value: null,
              suggestion_source: null,
              suggestion_confidence: null,
            },
            {
              row_number: 11,
              field: 'title',
              issue_code: 'missing_title',
              required: true,
              title: null,
              uid: '9781938660177',
              suggested_value: null,
              suggestion_source: null,
              suggestion_confidence: null,
            },
          ],
        });
      }
      if (path === '/api/v1/imports/storygraph') {
        return Promise.resolve({
          job_id: 'job-1',
          status: 'queued',
          total_rows: 0,
          processed_rows: 0,
          imported_rows: 0,
          failed_rows: 0,
          skipped_rows: 0,
          created_at: '2026-02-14T00:00:00Z',
        });
      }
      if (path === '/api/v1/imports/storygraph/job-1') {
        return Promise.resolve({
          job_id: 'job-1',
          status: 'completed',
          total_rows: 2,
          processed_rows: 2,
          imported_rows: 1,
          failed_rows: 0,
          skipped_rows: 1,
          error_summary: null,
          rows_preview: [],
        });
      }
      return Promise.resolve({});
    });

    const wrapper = mountPage();
    await flush(wrapper);

    const file = new File(['a,b\n'], 'storygraph.csv', { type: 'text/csv' });
    await selectFile(wrapper, file);
    await flush(wrapper);

    const issueInputs = wrapper.findAll('[data-test="storygraph-import-issue-input"]');
    await issueInputs[0]?.setValue('Author Added');
    const skipButtons = wrapper.findAll('[data-test="storygraph-import-issue-mark-skip"]');
    await skipButtons[1]?.trigger('click');
    await wrapper.vm.$nextTick();

    await wrapper.get('[data-test="storygraph-import-start"]').trigger('click');
    await flush(wrapper);

    const importCall = apiRequest.mock.calls.find(
      (call) => call[0] === '/api/v1/imports/storygraph',
    );
    const body = importCall?.[1]?.body as FormData;
    expect(body.get('author_overrides')).toBe('{"10":"Author Added"}');
    expect(body.get('skipped_rows')).toBe('[11]');
    expect(body.get('skip_reasons')).toBe('{"11":"missing_title"}');
    expect(wrapper.get('[data-test="storygraph-import-status"]').text()).toContain('completed');
  });
});

describe('settings page Goodreads import UX', () => {
  beforeEach(() => {
    apiRequest.mockReset();
    toastAdd.mockReset();
  });

  it('keeps Start disabled while issues are loading', async () => {
    vi.useFakeTimers();
    apiRequest.mockImplementation((path: string) => {
      if (path === '/api/v1/me') return Promise.resolve(mockProfile());
      if (path === '/api/v1/imports/goodreads/missing-required') {
        return new Promise((resolve) => setTimeout(() => resolve({ items: [] }), 50));
      }
      return Promise.resolve({});
    });

    const wrapper = mountPage();
    await flush(wrapper);

    const file = new File(['a,b\n'], 'goodreads.csv', { type: 'text/csv' });
    await selectGoodreadsFile(wrapper, file);
    await wrapper.vm.$nextTick();

    const startButton = wrapper.get('[data-test="goodreads-import-start"]');
    expect((startButton.element as HTMLButtonElement).disabled).toBe(true);
    expect(wrapper.get('[data-test="goodreads-issues-loading"]').text()).toContain('Checking CSV');

    await vi.runAllTimersAsync();
    await flush(wrapper);
    expect((startButton.element as HTMLButtonElement).disabled).toBe(false);
    vi.useRealTimers();
  });

  it('loads and saves profile settings', async () => {
    apiRequest.mockImplementation((path: string) => {
      if (path === '/api/v1/me') return Promise.resolve(mockProfile());
      return Promise.resolve({});
    });

    const wrapper = mountPage();
    await flush(wrapper);

    await wrapper.get('[data-test="settings-handle"]').setValue('new-handle');
    await wrapper.get('[data-test="settings-display-name"]').setValue('New Name');
    await wrapper.get('[data-test="settings-avatar-url"]').setValue('https://example.com/new.png');
    await wrapper.get('[data-test="settings-enable-google-books"]').setValue(true);
    await wrapper.get('[data-test="settings-save"]').trigger('click');
    await flush(wrapper);

    const patchCall = apiRequest.mock.calls.find((call) => call[0] === '/api/v1/me' && call[1]);
    expect(patchCall?.[1]).toMatchObject({
      method: 'PATCH',
      body: expect.objectContaining({ enable_google_books: true }),
    });
    expect(wrapper.get('[data-test="settings-saved"]').text()).toContain('Settings saved');
  });

  it('normalizes nullable profile fields', async () => {
    apiRequest.mockResolvedValueOnce({
      handle: 'seed',
      display_name: null,
      avatar_url: null,
      enable_google_books: false,
    });

    const wrapper = mountPage();
    await flush(wrapper);
    expect(
      (wrapper.get('[data-test="settings-display-name"]').element as HTMLInputElement).value,
    ).toBe('');
  });

  it('handles profile load and save error branches', async () => {
    apiRequest
      .mockRejectedValueOnce(new ApiClientErrorMock('No profile', 'bad_request', 400))
      .mockResolvedValueOnce(mockProfile())
      .mockRejectedValueOnce(new Error('boom'));

    const firstWrapper = mountPage();
    await flush(firstWrapper);
    expect(firstWrapper.get('[data-test="settings-error"]').text()).toContain('No profile');

    const secondWrapper = mountPage();
    await flush(secondWrapper);
    await secondWrapper.get('[data-test="settings-save"]').trigger('click');
    await flush(secondWrapper);
    expect(secondWrapper.get('[data-test="settings-error"]').text()).toContain(
      'Unable to save settings.',
    );
  });

  it('shows generic error when profile load fails without API details', async () => {
    apiRequest.mockRejectedValueOnce(new Error('boom'));

    const wrapper = mountPage();
    await flush(wrapper);
    expect(wrapper.get('[data-test="settings-error"]').text()).toContain(
      'Unable to load settings.',
    );
  });

  it('shows API message when save fails with ApiClientError', async () => {
    apiRequest
      .mockResolvedValueOnce(mockProfile())
      .mockRejectedValueOnce(new ApiClientErrorMock('Denied', 'denied', 403));

    const wrapper = mountPage();
    await flush(wrapper);
    await wrapper.get('[data-test="settings-save"]').trigger('click');
    await flush(wrapper);
    expect(wrapper.get('[data-test="settings-error"]').text()).toContain('Denied');
  });

  it('blocks Start until issues are resolved or skipped', async () => {
    apiRequest.mockImplementation((path: string) => {
      if (path === '/api/v1/me') return Promise.resolve(mockProfile());
      if (path === '/api/v1/imports/goodreads/missing-required') {
        return Promise.resolve({
          items: [
            {
              row_number: 150,
              field: 'authors',
              issue_code: 'missing_authors',
              required: true,
              title: 'A Small Key',
              uid: '9781938660177',
              suggested_value: null,
              suggestion_source: null,
              suggestion_confidence: null,
            },
          ],
        });
      }
      return Promise.resolve({});
    });

    const wrapper = mountPage();
    await flush(wrapper);

    const file = new File(['a,b\n'], 'goodreads.csv', { type: 'text/csv' });
    await selectGoodreadsFile(wrapper, file);
    await flush(wrapper);

    const startButton = wrapper.get('[data-test="goodreads-import-start"]');
    expect((startButton.element as HTMLButtonElement).disabled).toBe(true);

    await wrapper.get('[data-test="goodreads-import-issue-mark-skip"]').trigger('click');
    await wrapper.vm.$nextTick();

    expect((startButton.element as HTMLButtonElement).disabled).toBe(false);
    expect(toastAdd).toHaveBeenCalledWith(expect.objectContaining({ summary: 'Row skipped' }));
  });

  it('applies suggestion with visible feedback and enables Start', async () => {
    apiRequest.mockImplementation((path: string) => {
      if (path === '/api/v1/me') return Promise.resolve(mockProfile());
      if (path === '/api/v1/imports/goodreads/missing-required') {
        return Promise.resolve({
          items: [
            {
              row_number: 33,
              field: 'authors',
              issue_code: 'missing_authors',
              required: true,
              title: 'Book',
              uid: '9781938660177',
              suggested_value: 'Suggested Author',
              suggestion_source: 'openlibrary:isbn',
              suggestion_confidence: 'high',
            },
          ],
        });
      }
      return Promise.resolve({});
    });

    const wrapper = mountPage();
    await flush(wrapper);

    const file = new File(['a,b\n'], 'goodreads.csv', { type: 'text/csv' });
    await selectGoodreadsFile(wrapper, file);
    await flush(wrapper);

    await wrapper.get('[data-test="goodreads-import-issue-use-suggestion"]').trigger('click');
    await wrapper.vm.$nextTick();

    expect(
      (wrapper.get('[data-test="goodreads-import-start"]').element as HTMLButtonElement).disabled,
    ).toBe(false);
    expect(toastAdd).toHaveBeenCalledWith(
      expect.objectContaining({ summary: 'Suggestion applied' }),
    );
  });

  it('blocks import and supports retry when preflight fails', async () => {
    let shouldFail = true;
    apiRequest.mockImplementation((path: string) => {
      if (path === '/api/v1/me') return Promise.resolve(mockProfile());
      if (path === '/api/v1/imports/goodreads/missing-required') {
        if (shouldFail) throw new ApiClientErrorMock('Bad preflight', 'bad_preflight', 400);
        return Promise.resolve({ items: [] });
      }
      return Promise.resolve({});
    });

    const wrapper = mountPage();
    await flush(wrapper);

    const file = new File(['a,b\n'], 'goodreads.csv', { type: 'text/csv' });
    await selectGoodreadsFile(wrapper, file);
    await flush(wrapper);

    expect(wrapper.get('[data-test="goodreads-import-issues-error"]').text()).toContain(
      'Bad preflight',
    );
    expect(
      (wrapper.get('[data-test="goodreads-import-start"]').element as HTMLButtonElement).disabled,
    ).toBe(true);

    shouldFail = false;
    await wrapper.get('[data-test="goodreads-import-issues-retry"]').trigger('click');
    await flush(wrapper);

    expect(wrapper.find('[data-test="goodreads-import-issues-error"]').exists()).toBe(false);
    expect(
      (wrapper.get('[data-test="goodreads-import-start"]').element as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it('handles generic preflight error and no-file selection', async () => {
    apiRequest.mockImplementation((path: string) => {
      if (path === '/api/v1/me') return Promise.resolve(mockProfile());
      if (path === '/api/v1/imports/goodreads/missing-required') throw new Error('boom');
      return Promise.resolve({});
    });

    const wrapper = mountPage();
    await flush(wrapper);

    await selectGoodreadsFile(wrapper, new File(['a,b\n'], 'goodreads.csv', { type: 'text/csv' }));
    await flush(wrapper);
    expect(wrapper.get('[data-test="goodreads-import-issues-error"]').text()).toContain(
      'Unable to load import issues from Goodreads export.',
    );

    await selectGoodreadsFile(wrapper);
    await wrapper.vm.$nextTick();
    expect(wrapper.get('[data-test="goodreads-start-disabled-reason"]').text()).toContain(
      'Select a CSV file',
    );
  });

  it('renders title/read-status issue variants and supports undo skip', async () => {
    apiRequest.mockImplementation((path: string) => {
      if (path === '/api/v1/me') return Promise.resolve(mockProfile());
      if (path === '/api/v1/imports/goodreads/missing-required') {
        return Promise.resolve({
          items: [
            {
              row_number: 21,
              field: 'title',
              issue_code: 'missing_title',
              required: true,
              title: null,
              uid: '9781938660177',
              suggested_value: null,
              suggestion_source: null,
              suggestion_confidence: null,
            },
            {
              row_number: 22,
              field: 'read_status',
              issue_code: 'missing_read_status',
              required: true,
              title: 'Read Status Missing',
              uid: null,
              suggested_value: null,
              suggestion_source: null,
              suggestion_confidence: null,
            },
          ],
        });
      }
      return Promise.resolve({});
    });

    const wrapper = mountPage();
    await flush(wrapper);
    await selectGoodreadsFile(wrapper, new File(['a,b\n'], 'goodreads.csv', { type: 'text/csv' }));
    await flush(wrapper);

    const panelText = wrapper.get('[data-test="goodreads-import-issues"]').text();
    expect(panelText).toContain('Missing title');
    expect(panelText).toContain('Missing read status');

    const issueInputs = wrapper.findAll('[data-test="goodreads-import-issue-input"]');
    expect((issueInputs[1]?.element as HTMLInputElement).placeholder).toContain(
      'currently-reading',
    );

    const skipButtons = wrapper.findAll('[data-test="goodreads-import-issue-mark-skip"]');
    await skipButtons[0]?.trigger('click');
    await wrapper.vm.$nextTick();

    await wrapper.get('[data-test="goodreads-import-issue-undo-skip"]').trigger('click');
    await wrapper.vm.$nextTick();
    expect(toastAdd).toHaveBeenCalledWith(expect.objectContaining({ summary: 'Skip removed' }));
  });

  it('allows modify + done flow without auto-accepting suggestion', async () => {
    apiRequest.mockImplementation((path: string) => {
      if (path === '/api/v1/me') return Promise.resolve(mockProfile());
      if (path === '/api/v1/imports/goodreads/missing-required') {
        return Promise.resolve({
          items: [
            {
              row_number: 40,
              field: 'authors',
              issue_code: 'missing_authors',
              required: true,
              title: 'Book',
              uid: '9781938660177',
              suggested_value: 'Suggested Author',
              suggestion_source: 'openlibrary:isbn',
              suggestion_confidence: 'high',
            },
          ],
        });
      }
      return Promise.resolve({});
    });

    const wrapper = mountPage();
    await flush(wrapper);
    await selectGoodreadsFile(wrapper, new File(['a,b\n'], 'goodreads.csv', { type: 'text/csv' }));
    await flush(wrapper);

    expect(
      (wrapper.get('[data-test="goodreads-import-start"]').element as HTMLButtonElement).disabled,
    ).toBe(true);

    await wrapper.get('[data-test="goodreads-import-issue-modify"]').trigger('click');
    await wrapper.vm.$nextTick();

    const issueInput = wrapper.get('[data-test="goodreads-import-issue-input"]');
    expect((issueInput.element as HTMLInputElement).value).toBe('Suggested Author');
    await issueInput.setValue('Manual Author');
    await wrapper.get('[data-test="goodreads-import-issue-done"]').trigger('click');
    await wrapper.vm.$nextTick();

    expect(
      (wrapper.get('[data-test="goodreads-import-start"]').element as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it('clears import state from clear button and unmounts safely', async () => {
    apiRequest.mockImplementation((path: string) => {
      if (path === '/api/v1/me') return Promise.resolve(mockProfile());
      if (path === '/api/v1/imports/goodreads/missing-required')
        return Promise.resolve({ items: [] });
      return Promise.resolve({});
    });

    const wrapper = mountPage();
    await flush(wrapper);
    await selectGoodreadsFile(wrapper, new File(['a,b\n'], 'goodreads.csv', { type: 'text/csv' }));
    await flush(wrapper);

    await wrapper.get('[data-test="goodreads-file-clear"]').trigger('click');
    await flush(wrapper);
    expect(wrapper.get('[data-test="goodreads-start-disabled-reason"]').text()).toContain(
      'Select a CSV file',
    );

    wrapper.unmount();
  });

  it('covers retry/suggestion guard paths and resolved undo branch', async () => {
    apiRequest.mockResolvedValue(mockProfile());
    const wrapper = mountPage();
    await flush(wrapper);

    const setupState = (wrapper.vm as any).$?.setupState;
    expect(setupState).toBeTruthy();

    const beforeCalls = apiRequest.mock.calls.length;
    await setupState.retryLoadImportIssues();
    expect(apiRequest.mock.calls.length).toBe(beforeCalls);

    const noSuggestionIssue = {
      row_number: 7,
      suggested_value: null,
      value: '',
      resolution: 'pending',
      skipReasonCode: 'missing_authors',
    };
    setupState.applySuggestion(noSuggestionIssue);
    expect(toastAdd).not.toHaveBeenCalledWith(
      expect.objectContaining({ summary: 'Suggestion applied' }),
    );

    const resolvedUndoIssue = {
      row_number: 8,
      suggested_value: null,
      value: 'Author Name',
      resolution: 'skipped',
      skipReasonCode: 'missing_authors',
    };
    setupState.undoGoodreadsIssueSkip(resolvedUndoIssue);
    expect(resolvedUndoIssue.resolution).toBe('resolved');

    const editIssue = {
      row_number: 9,
      suggested_value: 'Suggested',
      value: 'Manual',
      resolution: 'pending',
      isEditing: false,
      skipReasonCode: 'missing_authors',
    };
    setupState.startGoodreadsIssueEdit(editIssue);
    expect(editIssue.value).toBe('Manual');
    expect(editIssue.resolution).toBe('resolved');
    editIssue.value = '';
    setupState.finishGoodreadsIssueEdit(editIssue);
    expect(editIssue.resolution).toBe('pending');

    setupState.goodreadsFile = new File(['a,b\n'], 'goodreads.csv', { type: 'text/csv' });
    setupState.goodreadsIssuesLoading = false;
    setupState.goodreadsIssuesLoadError = '';
    setupState.goodreadsIssuesLoaded = false;
    expect(setupState.goodreadsStartDisabledReason).toContain('Issue check has not completed');

    const pendingInputIssue = {
      row_number: 10,
      suggested_value: null,
      value: '',
      resolution: 'resolved',
      isEditing: false,
      skipReasonCode: 'missing_authors',
    };
    setupState.onGoodreadsIssueValueInput(pendingInputIssue, '   ');
    expect(pendingInputIssue.resolution).toBe('pending');
  });

  it('covers picker click and label/confidence fallbacks', async () => {
    apiRequest.mockResolvedValue(mockProfile());
    const wrapper = mountPage();
    await flush(wrapper);

    const setupState = (wrapper.vm as any).$?.setupState;
    expect(setupState).toBeTruthy();

    let clicked = 0;
    setupState.goodreadsFileInput = { click: () => clicked++ };
    setupState.openGoodreadsPicker();
    expect(clicked).toBe(1);

    expect(setupState.goodreadsIssueResolutionLabel('pending')).toBe('Pending');
    expect(setupState.goodreadsIssueResolutionSeverity('pending')).toBe('secondary');

    const noSuggestion = {
      suggestion_confidence: null,
      suggestion_source: null,
    };
    expect(setupState.goodreadsSuggestionConfidenceText(noSuggestion)).toBe('');
  });

  it('shows import start API errors', async () => {
    apiRequest.mockImplementation((path: string) => {
      if (path === '/api/v1/me') return Promise.resolve(mockProfile());
      if (path === '/api/v1/imports/goodreads/missing-required')
        return Promise.resolve({ items: [] });
      if (path === '/api/v1/imports/goodreads') {
        throw new ApiClientErrorMock('Bad CSV', 'bad_csv', 400);
      }
      return Promise.resolve({});
    });

    const wrapper = mountPage();
    await flush(wrapper);
    await selectGoodreadsFile(wrapper, new File(['a,b\n'], 'goodreads.csv', { type: 'text/csv' }));
    await flush(wrapper);

    await wrapper.get('[data-test="goodreads-import-start"]').trigger('click');
    await flush(wrapper);
    expect(wrapper.get('[data-test="goodreads-import-error"]').text()).toContain('Bad CSV');
  });

  it('renders job error summary and failed/skipped preview rows', async () => {
    apiRequest.mockImplementation((path: string) => {
      if (path === '/api/v1/me') return Promise.resolve(mockProfile());
      if (path === '/api/v1/imports/goodreads/missing-required')
        return Promise.resolve({ items: [] });
      if (path === '/api/v1/imports/goodreads') {
        return Promise.resolve({
          job_id: 'job-preview',
          status: 'queued',
          total_rows: 0,
          processed_rows: 0,
          imported_rows: 0,
          failed_rows: 0,
          skipped_rows: 0,
          created_at: '2026-02-14T00:00:00Z',
        });
      }
      if (path === '/api/v1/imports/goodreads/job-preview') {
        return Promise.resolve({
          job_id: 'job-preview',
          status: 'completed',
          total_rows: 2,
          processed_rows: 2,
          imported_rows: 1,
          failed_rows: 1,
          skipped_rows: 0,
          error_summary: 'authors missing (1 rows)',
          rows_preview: [{ row_number: 150, result: 'failed', message: 'authors missing' }],
        });
      }
      return Promise.resolve({});
    });

    const wrapper = mountPage();
    await flush(wrapper);
    await selectGoodreadsFile(wrapper, new File(['a,b\n'], 'goodreads.csv', { type: 'text/csv' }));
    await flush(wrapper);

    await wrapper.get('[data-test="goodreads-import-start"]').trigger('click');
    await flush(wrapper);
    expect(wrapper.get('[data-test="goodreads-import-error-summary"]').text()).toContain(
      'authors missing',
    );
    expect(wrapper.get('[data-test="goodreads-import-preview"]').text()).toContain('Row 150');
  });

  it('clears polling timer when unmounting during running import', async () => {
    vi.useFakeTimers();
    apiRequest.mockImplementation((path: string) => {
      if (path === '/api/v1/me') return Promise.resolve(mockProfile());
      if (path === '/api/v1/imports/goodreads/missing-required')
        return Promise.resolve({ items: [] });
      if (path === '/api/v1/imports/goodreads') {
        return Promise.resolve({
          job_id: 'job-running',
          status: 'queued',
          total_rows: 0,
          processed_rows: 0,
          imported_rows: 0,
          failed_rows: 0,
          skipped_rows: 0,
          created_at: '2026-02-14T00:00:00Z',
        });
      }
      if (path === '/api/v1/imports/goodreads/job-running') {
        return Promise.resolve({
          job_id: 'job-running',
          status: 'running',
          total_rows: 2,
          processed_rows: 1,
          imported_rows: 1,
          failed_rows: 0,
          skipped_rows: 0,
          error_summary: null,
          rows_preview: [],
        });
      }
      return Promise.resolve({});
    });

    const wrapper = mountPage();
    await flush(wrapper);
    await selectGoodreadsFile(wrapper, new File(['a,b\n'], 'goodreads.csv', { type: 'text/csv' }));
    await flush(wrapper);

    await wrapper.get('[data-test="goodreads-import-start"]').trigger('click');
    await flush(wrapper);
    await vi.runOnlyPendingTimersAsync();
    wrapper.unmount();
    vi.useRealTimers();
  });

  it('submits overrides and skipped rows in a single import request', async () => {
    apiRequest.mockImplementation((path: string) => {
      if (path === '/api/v1/me') return Promise.resolve(mockProfile());
      if (path === '/api/v1/imports/goodreads/missing-required') {
        return Promise.resolve({
          items: [
            {
              row_number: 10,
              field: 'authors',
              issue_code: 'missing_authors',
              required: true,
              title: 'Book A',
              uid: null,
              suggested_value: null,
              suggestion_source: null,
              suggestion_confidence: null,
            },
            {
              row_number: 11,
              field: 'title',
              issue_code: 'missing_title',
              required: true,
              title: null,
              uid: '9781938660177',
              suggested_value: null,
              suggestion_source: null,
              suggestion_confidence: null,
            },
          ],
        });
      }
      if (path === '/api/v1/imports/goodreads') {
        return Promise.resolve({
          job_id: 'job-1',
          status: 'queued',
          total_rows: 0,
          processed_rows: 0,
          imported_rows: 0,
          failed_rows: 0,
          skipped_rows: 0,
          created_at: '2026-02-14T00:00:00Z',
        });
      }
      if (path === '/api/v1/imports/goodreads/job-1') {
        return Promise.resolve({
          job_id: 'job-1',
          status: 'completed',
          total_rows: 2,
          processed_rows: 2,
          imported_rows: 1,
          failed_rows: 0,
          skipped_rows: 1,
          error_summary: null,
          rows_preview: [],
        });
      }
      return Promise.resolve({});
    });

    const wrapper = mountPage();
    await flush(wrapper);

    const file = new File(['a,b\n'], 'goodreads.csv', { type: 'text/csv' });
    await selectGoodreadsFile(wrapper, file);
    await flush(wrapper);

    const issueInputs = wrapper.findAll('[data-test="goodreads-import-issue-input"]');
    await issueInputs[0]?.setValue('Author Added');
    const skipButtons = wrapper.findAll('[data-test="goodreads-import-issue-mark-skip"]');
    await skipButtons[1]?.trigger('click');
    await wrapper.vm.$nextTick();

    await wrapper.get('[data-test="goodreads-import-start"]').trigger('click');
    await flush(wrapper);

    const importCall = apiRequest.mock.calls.find(
      (call) => call[0] === '/api/v1/imports/goodreads',
    );
    const body = importCall?.[1]?.body as FormData;
    expect(body.get('author_overrides')).toBe('{"10":"Author Added"}');
    expect(body.get('skipped_rows')).toBe('[11]');
    expect(body.get('skip_reasons')).toBe('{"11":"missing_title"}');
    expect(wrapper.get('[data-test="goodreads-import-status"]').text()).toContain('completed');
  });
});
