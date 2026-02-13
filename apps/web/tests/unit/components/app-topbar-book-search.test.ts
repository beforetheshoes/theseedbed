import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import PrimeVue from 'primevue/config';

const state = vi.hoisted(() => ({
  popoverShow: vi.fn(),
  popoverHide: vi.fn(),
}));

const apiRequest = vi.hoisted(() => vi.fn());
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

const toastAdd = vi.hoisted(() => vi.fn());
const navigateToMock = vi.hoisted(() => vi.fn());

vi.mock('~/utils/api', () => ({
  apiRequest,
  ApiClientError: ApiClientErrorMock,
}));

vi.mock('#imports', () => ({
  navigateTo: navigateToMock,
}));

vi.mock('primevue/usetoast', () => ({
  useToast: () => ({ add: toastAdd }),
}));

import AppTopBarBookSearch from '../../../app/components/shell/AppTopBarBookSearch.vue';

const ButtonStub = defineComponent({
  name: 'Button',
  emits: ['click'],
  setup:
    (_props, { attrs, slots, emit }) =>
    () =>
      h(
        'button',
        { ...attrs, onClick: (e: any) => emit('click', e) },
        slots.default?.({ class: 'p-button' }) ?? attrs['label'] ?? '',
      ),
});

const InputTextStub = defineComponent({
  name: 'InputText',
  props: ['modelValue'],
  emits: ['update:modelValue', 'focus'],
  setup: (props, { attrs, emit }) => {
    return () =>
      h('input', {
        ...attrs,
        value: props.modelValue ?? '',
        onInput: (e: any) => emit('update:modelValue', e?.target?.value ?? ''),
        onFocus: (e: any) => emit('focus', e),
      });
  },
});

const SelectButtonStub = defineComponent({
  name: 'SelectButton',
  props: ['modelValue', 'options', 'optionLabel', 'optionValue'],
  emits: ['update:modelValue'],
  setup: (props, { attrs, emit }) => {
    const valueOf = (opt: any) => {
      const key = props.optionValue || 'value';
      return opt?.[key] ?? opt;
    };
    const labelOf = (opt: any) => {
      const key = props.optionLabel || 'label';
      return opt?.[key] ?? String(opt);
    };
    return () =>
      h(
        'div',
        { ...attrs },
        (props.options || []).map((opt: any) =>
          h(
            'button',
            {
              key: String(valueOf(opt)),
              'data-test': `scope-${String(valueOf(opt))}`,
              onClick: () => emit('update:modelValue', valueOf(opt)),
            },
            labelOf(opt),
          ),
        ),
      );
  },
});

const PopoverStub = defineComponent({
  name: 'Popover',
  setup: (_props, { slots, attrs, expose }) => {
    expose({
      show: state.popoverShow,
      hide: state.popoverHide,
      toggle: vi.fn(),
    });
    return () => h('div', { ...attrs }, slots.default?.());
  },
});

const DialogStub = defineComponent({
  name: 'Dialog',
  props: ['visible'],
  emits: ['update:visible'],
  setup:
    (_props, { slots, attrs, emit }) =>
    () =>
      h('div', { ...attrs }, [
        h('button', {
          'data-test': 'dialog-update-visible-false',
          onClick: () => emit('update:visible', false),
        }),
        slots.default?.(),
      ]),
});

const CardStub = defineComponent({
  name: 'Card',
  setup:
    (_props, { slots, attrs }) =>
    () =>
      h('div', { ...attrs }, slots.content?.()),
});

const FieldsetStub = defineComponent({
  name: 'Fieldset',
  setup:
    (_props, { slots, attrs }) =>
    () =>
      h('fieldset', { ...attrs }, [h('legend', {}, attrs.legend as string), slots.default?.()]),
});

const MessageStub = defineComponent({
  name: 'Message',
  setup:
    (_props, { slots, attrs }) =>
    () =>
      h('div', { ...attrs }, slots.default?.()),
});

const SkeletonStub = defineComponent({
  name: 'Skeleton',
  setup:
    (_props, { attrs }) =>
    () =>
      h('div', { ...attrs }),
});

describe('AppTopBarBookSearch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    apiRequest.mockReset();
    toastAdd.mockReset();
    navigateToMock.mockReset();
    state.popoverShow.mockReset();
    state.popoverHide.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const mountSearch = () =>
    mount(AppTopBarBookSearch, {
      global: {
        plugins: [[PrimeVue, { ripple: false }]],
        stubs: {
          Button: ButtonStub,
          InputText: InputTextStub,
          SelectButton: SelectButtonStub,
          Popover: PopoverStub,
          Dialog: DialogStub,
          Card: CardStub,
          Fieldset: FieldsetStub,
          Message: MessageStub,
          Skeleton: SkeletonStub,
        },
      },
    });

  it('scope=My Library only calls library search', async () => {
    apiRequest.mockResolvedValue({ items: [] });
    const wrapper = mountSearch();

    await wrapper.get('[data-test="scope-my"]').trigger('click');
    await wrapper.get('[data-test="topbar-search-input"]').setValue('hat');
    await vi.advanceTimersByTimeAsync(350);
    await nextTick();

    const paths = apiRequest.mock.calls.map((call) => call[0]);
    expect(paths).toContain('/api/v1/library/search');
    expect(paths).not.toContain('/api/v1/books/search');
  });

  it('renders a loading state while a search request is pending', async () => {
    // eslint-disable-next-line no-unused-vars -- param name in function type triggers this rule in this repo.
    let resolveLibrary: ((value: any) => void) | null = null;
    const pendingLibrary = new Promise((resolve) => {
      resolveLibrary = resolve;
    });

    apiRequest.mockImplementation(async (path: string) => {
      if (path === '/api/v1/library/search') {
        return await pendingLibrary;
      }
      throw new Error(`unexpected call: ${path}`);
    });

    const wrapper = mountSearch();
    await wrapper.get('[data-test="scope-my"]').trigger('click');
    await wrapper.get('[data-test="topbar-search-input"]').setValue('hat');
    await vi.advanceTimersByTimeAsync(350);
    await nextTick();

    expect(wrapper.find('[data-test="topbar-search-loading"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="topbar-search-loading-mobile"]').exists()).toBe(true);

    resolveLibrary?.({ items: [] });
    await nextTick();
  });

  it('scope=Global only calls Open Library search', async () => {
    apiRequest.mockResolvedValue({ items: [] });
    const wrapper = mountSearch();

    await wrapper.get('[data-test="scope-global"]').trigger('click');
    await wrapper.get('[data-test="topbar-search-input"]').setValue('hat');
    await vi.advanceTimersByTimeAsync(350);
    await nextTick();

    const paths = apiRequest.mock.calls.map((call) => call[0]);
    expect(paths).toContain('/api/v1/books/search');
    expect(paths).not.toContain('/api/v1/library/search');
  });

  it('scope=Both calls both endpoints and dedupes Open Library results already in library', async () => {
    apiRequest.mockImplementation(async (path: string) => {
      if (path === '/api/v1/library/search') {
        return {
          items: [
            {
              work_id: 'work-1',
              work_title: 'Hatchet',
              author_names: ['Gary Paulsen'],
              cover_url: null,
              openlibrary_work_key: '/works/OL1W',
            },
          ],
        };
      }
      if (path === '/api/v1/books/search') {
        return {
          items: [
            {
              work_key: '/works/OL1W',
              title: 'Hatchet',
              author_names: ['Gary Paulsen'],
              first_publish_year: 1987,
              cover_url: 'https://example.com/hatchet.jpg',
            },
            {
              work_key: '/works/OL2W',
              title: 'The Hat',
              author_names: ['Someone'],
              first_publish_year: 2000,
              cover_url: 'https://example.com/the-hat.jpg',
            },
          ],
        };
      }
      throw new Error(`unexpected call: ${path}`);
    });

    const wrapper = mountSearch();
    await wrapper.get('[data-test="topbar-search-input"]').setValue('hat');
    await vi.advanceTimersByTimeAsync(350);
    await nextTick();

    expect(wrapper.find('[data-test="topbar-search-open-work-1"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="topbar-search-add-/works/OL1W"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="topbar-search-add-/works/OL2W"]').exists()).toBe(true);
    // Cover branch that renders a cover image when cover_url is present.
    expect(wrapper.find('[data-test="topbar-search-results"] img').exists()).toBe(true);
  });

  it('ignores stale library responses (second request wins)', async () => {
    // eslint-disable-next-line no-unused-vars -- param name in function type triggers this rule in this repo.
    let resolveOld: ((value: any) => void) | null = null;
    const oldPromise = new Promise((resolve) => {
      resolveOld = resolve;
    });

    apiRequest.mockImplementation(async (path: string, opts?: any) => {
      if (path === '/api/v1/library/search') {
        const q = opts?.query?.query;
        if (q === 'ha') {
          return await oldPromise;
        }
        if (q === 'hat') {
          return {
            items: [
              {
                work_id: 'work-new',
                work_title: 'New Result',
                author_names: ['A'],
                cover_url: null,
                openlibrary_work_key: '/works/OLNEW',
              },
            ],
          };
        }
        return { items: [] };
      }
      throw new Error(`unexpected call: ${path}`);
    });

    const wrapper = mountSearch();
    await wrapper.get('[data-test="scope-my"]').trigger('click');

    await wrapper.get('[data-test="topbar-search-input"]').setValue('ha');
    await vi.advanceTimersByTimeAsync(350);
    await nextTick();

    await wrapper.get('[data-test="topbar-search-input"]').setValue('hat');
    await vi.advanceTimersByTimeAsync(350);
    await nextTick();

    expect(wrapper.find('[data-test="topbar-search-open-work-new"]').exists()).toBe(true);

    resolveOld?.({
      items: [
        {
          work_id: 'work-old',
          work_title: 'Old Result',
          author_names: ['B'],
          cover_url: null,
          openlibrary_work_key: '/works/OLOLD',
        },
      ],
    });
    await nextTick();

    expect(wrapper.find('[data-test="topbar-search-open-work-new"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="topbar-search-open-work-old"]').exists()).toBe(false);
  });

  it('does not set an error for stale search failures', async () => {
    // eslint-disable-next-line no-unused-vars -- param name in function type triggers this rule in this repo.
    let rejectOld: ((err: any) => void) | null = null;
    const oldPromise = new Promise((_, reject) => {
      rejectOld = reject;
    });

    apiRequest.mockImplementation(async (path: string, opts?: any) => {
      if (path === '/api/v1/library/search') {
        const q = opts?.query?.query;
        if (q === 'ha') {
          return await oldPromise;
        }
        if (q === 'hat') {
          return { items: [] };
        }
        return { items: [] };
      }
      throw new Error(`unexpected call: ${path}`);
    });

    const wrapper = mountSearch();
    await wrapper.get('[data-test="scope-my"]').trigger('click');

    await wrapper.get('[data-test="topbar-search-input"]').setValue('ha');
    await vi.advanceTimersByTimeAsync(350);
    await nextTick();

    await wrapper.get('[data-test="topbar-search-input"]').setValue('hat');
    await vi.advanceTimersByTimeAsync(350);
    await nextTick();

    rejectOld?.(new ApiClientErrorMock('Old failed', 'request_failed', 500));
    await nextTick();

    expect(wrapper.find('[data-test="topbar-search-error"]').exists()).toBe(false);
  });

  it('ignores stale Open Library responses (second request wins)', async () => {
    // eslint-disable-next-line no-unused-vars -- param name in function type triggers this rule in this repo.
    let resolveOldOl: ((value: any) => void) | null = null;
    const oldOlPromise = new Promise((resolve) => {
      resolveOldOl = resolve;
    });

    apiRequest.mockImplementation(async (path: string, opts?: any) => {
      const q = opts?.query?.query;

      if (path === '/api/v1/library/search') {
        return { items: [] };
      }
      if (path === '/api/v1/books/search') {
        if (q === 'ha') {
          return await oldOlPromise;
        }
        if (q === 'hat') {
          return { items: [] };
        }
        return { items: [] };
      }
      throw new Error(`unexpected call: ${path}`);
    });

    const wrapper = mountSearch();

    await wrapper.get('[data-test="topbar-search-input"]').setValue('ha');
    await vi.advanceTimersByTimeAsync(350);
    await nextTick();

    await wrapper.get('[data-test="topbar-search-input"]').setValue('hat');
    await vi.advanceTimersByTimeAsync(350);
    await nextTick();

    resolveOldOl?.({
      items: [
        {
          work_key: '/works/OL-STALE',
          title: 'Stale OL',
          author_names: ['X'],
          first_publish_year: 2020,
          cover_url: null,
        },
      ],
    });
    await nextTick();

    expect(wrapper.find('[data-test="topbar-search-add-/works/OL-STALE"]').exists()).toBe(false);
  });

  it('clear resets query and transient errors', async () => {
    apiRequest.mockRejectedValueOnce(new ApiClientErrorMock('Nope', 'request_failed', 500));
    const wrapper = mountSearch();

    await wrapper.get('[data-test="scope-my"]').trigger('click');
    await wrapper.get('[data-test="topbar-search-input"]').setValue('hat');
    await vi.advanceTimersByTimeAsync(350);
    await nextTick();

    expect(wrapper.find('[data-test="topbar-search-error"]').exists()).toBe(true);
    await wrapper.get('[data-test="topbar-search-clear"]').trigger('click');
    await nextTick();

    expect(
      (wrapper.get('[data-test="topbar-search-input"]').element as HTMLInputElement).value,
    ).toBe('');
    expect(wrapper.find('[data-test="topbar-search-error"]').exists()).toBe(false);
  });

  it('openPopover no-ops if the anchor element is missing', async () => {
    const wrapper = mountSearch();
    const callsBefore = state.popoverShow.mock.calls.length;

    (wrapper.vm as any).anchorEl = null;
    (wrapper.vm as any).openPopover();
    await nextTick();

    expect(state.popoverShow.mock.calls.length).toBe(callsBefore);
  });

  it('does not search for queries shorter than 2 characters', async () => {
    apiRequest.mockResolvedValue({ items: [] });
    const wrapper = mountSearch();

    await wrapper.get('[data-test="topbar-search-input"]').setValue('h');
    await vi.advanceTimersByTimeAsync(350);
    await nextTick();

    expect(apiRequest).not.toHaveBeenCalled();
  });

  it('shows an empty-state hint when no results are found for a valid query', async () => {
    apiRequest.mockResolvedValueOnce({ items: [] });
    const wrapper = mountSearch();

    await wrapper.get('[data-test="scope-my"]').trigger('click');
    await wrapper.get('[data-test="topbar-search-input"]').setValue('hat');
    await vi.advanceTimersByTimeAsync(350);
    await nextTick();

    expect(wrapper.get('[data-test="topbar-search-hint"]').text()).toContain('No books found');
  });

  it('refocusing the input reopens the popover when a query is active', async () => {
    apiRequest.mockResolvedValueOnce({ items: [] });
    const wrapper = mountSearch();

    await wrapper.get('[data-test="scope-my"]').trigger('click');
    await wrapper.get('[data-test="topbar-search-input"]').setValue('hat');
    await vi.advanceTimersByTimeAsync(350);
    await nextTick();

    const callsBefore = state.popoverShow.mock.calls.length;
    await wrapper.get('[data-test="topbar-search-input"]').trigger('focus');
    await nextTick();
    expect(state.popoverShow.mock.calls.length).toBeGreaterThan(callsBefore);
  });

  it('refocusing does not open the popover for short queries', async () => {
    const wrapper = mountSearch();
    const callsBefore = state.popoverShow.mock.calls.length;

    await wrapper.get('[data-test="topbar-search-input"]').setValue('h');
    await wrapper.get('[data-test="topbar-search-input"]').trigger('focus');
    await nextTick();

    expect(state.popoverShow.mock.calls.length).toBe(callsBefore);
  });

  it('mobile open/close toggles the dialog v-model handlers', async () => {
    const wrapper = mountSearch();

    await wrapper.get('[data-test="topbar-search-mobile-open"]').trigger('click');
    await wrapper.get('[data-test="topbar-search-mobile-close"]').trigger('click');
    await wrapper.get('[data-test="dialog-update-visible-false"]').trigger('click');
  });

  it('mobile controls render and the mobile clear button clears the shared query', async () => {
    const wrapper = mountSearch();

    await wrapper.get('[data-test="topbar-search-mobile-open"]').trigger('click');
    await wrapper.get('[data-test="topbar-search-input-mobile"]').setValue('hat');
    await nextTick();

    expect(wrapper.find('[data-test="topbar-search-clear-mobile"]').exists()).toBe(true);
    await wrapper.get('[data-test="topbar-search-clear-mobile"]').trigger('click');
    await nextTick();

    expect(
      (wrapper.get('[data-test="topbar-search-input"]').element as HTMLInputElement).value,
    ).toBe('');
  });

  it('mobile scope selector updates scope and reruns search', async () => {
    apiRequest.mockResolvedValue({ items: [] });
    const wrapper = mountSearch();

    await wrapper.get('[data-test="topbar-search-mobile-open"]').trigger('click');
    await wrapper.get('[data-test="topbar-search-input-mobile"]').setValue('hat');
    await vi.advanceTimersByTimeAsync(350);
    await nextTick();

    await wrapper
      .get('[data-test="topbar-search-scope-mobile"] [data-test="scope-my"]')
      .trigger('click');
    await nextTick();

    const paths = apiRequest.mock.calls.map((call) => call[0]);
    expect(paths).toContain('/api/v1/library/search');
  });

  it('changing scope reruns search immediately with the same query', async () => {
    apiRequest
      .mockResolvedValueOnce({
        items: [
          {
            work_id: 'work-1',
            work_title: 'Hatchet',
            author_names: ['Gary Paulsen'],
            cover_url: null,
            openlibrary_work_key: '/works/OL1W',
          },
        ],
      })
      .mockResolvedValueOnce({
        items: [
          {
            work_key: '/works/OL2W',
            title: 'The Hat',
            author_names: ['Someone'],
            first_publish_year: 2000,
            cover_url: null,
          },
        ],
      });

    const wrapper = mountSearch();
    await wrapper.get('[data-test="scope-my"]').trigger('click');
    await wrapper.get('[data-test="topbar-search-input"]').setValue('hat');
    await vi.advanceTimersByTimeAsync(350);
    await nextTick();

    const callsBefore = apiRequest.mock.calls.length;
    await wrapper.get('[data-test="scope-global"]').trigger('click');
    await nextTick();

    expect(apiRequest.mock.calls.length).toBeGreaterThan(callsBefore);
    expect(apiRequest.mock.calls.at(-1)?.[0]).toBe('/api/v1/books/search');
  });

  it('opening a library item navigates and clears search', async () => {
    apiRequest.mockResolvedValueOnce({
      items: [
        {
          work_id: 'work-1',
          work_title: 'Hatchet',
          author_names: ['Gary Paulsen'],
          cover_url: null,
          openlibrary_work_key: '/works/OL1W',
        },
      ],
    });

    const wrapper = mountSearch();
    await wrapper.get('[data-test="scope-my"]').trigger('click');
    await wrapper.get('[data-test="topbar-search-input"]').setValue('hat');
    await vi.advanceTimersByTimeAsync(350);
    await nextTick();

    await wrapper.get('[data-test="topbar-search-open-work-1"]').trigger('click');
    await Promise.resolve();
    await nextTick();

    expect(navigateToMock).toHaveBeenCalledWith('/books/work-1');
    expect(
      (wrapper.get('[data-test="topbar-search-input"]').element as HTMLInputElement).value,
    ).toBe('');
  });

  it('mobile open action navigates using the shared open handler', async () => {
    apiRequest.mockResolvedValueOnce({
      items: [
        {
          work_id: 'work-1',
          work_title: 'Hatchet',
          author_names: ['Gary Paulsen'],
          cover_url: null,
          openlibrary_work_key: '/works/OL1W',
        },
      ],
    });

    const wrapper = mountSearch();
    await wrapper.get('[data-test="scope-my"]').trigger('click');
    await wrapper.get('[data-test="topbar-search-input"]').setValue('hat');
    await vi.advanceTimersByTimeAsync(350);
    await nextTick();

    await wrapper.get('[data-test="topbar-search-open-mobile-work-1"]').trigger('click');
    await Promise.resolve();
    await nextTick();

    expect(navigateToMock).toHaveBeenCalledWith('/books/work-1');
  });

  it('mobile add action imports and adds', async () => {
    apiRequest
      .mockResolvedValueOnce({
        items: [
          {
            work_key: '/works/OL2W',
            title: 'The Hat',
            author_names: ['Someone'],
            first_publish_year: 2000,
            cover_url: null,
          },
        ],
      })
      .mockResolvedValueOnce({ work: { id: 'work-imported' } })
      .mockResolvedValueOnce({ created: true });

    const wrapper = mountSearch();
    await wrapper.get('[data-test="scope-global"]').trigger('click');
    await wrapper.get('[data-test="topbar-search-input"]').setValue('hat');
    await vi.advanceTimersByTimeAsync(350);
    await nextTick();

    await wrapper.get('[data-test="topbar-search-add-mobile-/works/OL2W"]').trigger('click');
    await nextTick();

    expect(apiRequest).toHaveBeenCalledWith('/api/v1/books/import', expect.anything());
    expect(apiRequest).toHaveBeenCalledWith('/api/v1/library/items', expect.anything());
  });

  it('shows the already-added toast message when the book is already in the library', async () => {
    apiRequest
      .mockResolvedValueOnce({
        items: [
          {
            work_key: '/works/OL2W',
            title: 'The Hat',
            author_names: ['Someone'],
            first_publish_year: 2000,
            cover_url: null,
          },
        ],
      })
      .mockResolvedValueOnce({ work: { id: 'work-imported' } })
      .mockResolvedValueOnce({ created: false });

    const wrapper = mountSearch();
    await wrapper.get('[data-test="scope-global"]').trigger('click');
    await wrapper.get('[data-test="topbar-search-input"]').setValue('hat');
    await vi.advanceTimersByTimeAsync(350);
    await nextTick();

    await wrapper.get('[data-test="topbar-search-add-/works/OL2W"]').trigger('click');
    await nextTick();

    expect(toastAdd).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'success', summary: expect.stringContaining('already') }),
    );
  });

  it('toasts an error if add fails', async () => {
    apiRequest
      .mockResolvedValueOnce({
        items: [
          {
            work_key: '/works/OL2W',
            title: 'The Hat',
            author_names: ['Someone'],
            first_publish_year: 2000,
            cover_url: null,
          },
        ],
      })
      .mockRejectedValueOnce(new ApiClientErrorMock('Import failed', 'request_failed', 500));

    const wrapper = mountSearch();
    await wrapper.get('[data-test="scope-global"]').trigger('click');
    await wrapper.get('[data-test="topbar-search-input"]').setValue('hat');
    await vi.advanceTimersByTimeAsync(350);
    await nextTick();

    await wrapper.get('[data-test="topbar-search-add-/works/OL2W"]').trigger('click');
    await nextTick();

    expect(toastAdd).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'error', summary: 'Import failed' }),
    );
  });

  it('shows a default message for non-ApiClientError search failures', async () => {
    apiRequest.mockRejectedValueOnce(new Error('boom'));
    const wrapper = mountSearch();

    await wrapper.get('[data-test="scope-my"]').trigger('click');
    await wrapper.get('[data-test="topbar-search-input"]').setValue('hat');
    await vi.advanceTimersByTimeAsync(350);
    await nextTick();

    expect(wrapper.get('[data-test="topbar-search-error"]').text()).toContain(
      'Unable to search right now.',
    );
  });

  it('toasts a default message for non-ApiClientError add failures', async () => {
    apiRequest
      .mockResolvedValueOnce({
        items: [
          {
            work_key: '/works/OL2W',
            title: 'The Hat',
            author_names: ['Someone'],
            first_publish_year: 2000,
            cover_url: null,
          },
        ],
      })
      .mockRejectedValueOnce(new Error('boom'));

    const wrapper = mountSearch();
    await wrapper.get('[data-test="scope-global"]').trigger('click');
    await wrapper.get('[data-test="topbar-search-input"]').setValue('hat');
    await vi.advanceTimersByTimeAsync(350);
    await nextTick();

    await wrapper.get('[data-test="topbar-search-add-/works/OL2W"]').trigger('click');
    await nextTick();

    expect(toastAdd).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'error', summary: 'Unable to add this book right now.' }),
    );
  });

  it('mobile results can render a cover image when cover_url is present', async () => {
    apiRequest.mockResolvedValueOnce({
      items: [
        {
          work_key: '/works/OL2W',
          title: 'The Hat',
          author_names: ['Someone'],
          first_publish_year: 2000,
          cover_url: 'https://example.com/the-hat.jpg',
        },
      ],
    });

    const wrapper = mountSearch();
    await wrapper.get('[data-test="topbar-search-mobile-open"]').trigger('click');
    await wrapper.get('[data-test="scope-global"]').trigger('click');
    await wrapper.get('[data-test="topbar-search-input-mobile"]').setValue('hat');
    await vi.advanceTimersByTimeAsync(350);
    await nextTick();

    expect(wrapper.find('[data-test="topbar-search-results-mobile"] img').exists()).toBe(true);
  });

  it('mobile hint shows empty-state copy for valid queries with no results', async () => {
    apiRequest.mockResolvedValueOnce({ items: [] });
    const wrapper = mountSearch();

    await wrapper.get('[data-test="topbar-search-mobile-open"]').trigger('click');
    await wrapper.get('[data-test="scope-global"]').trigger('click');
    await wrapper.get('[data-test="topbar-search-input-mobile"]').setValue('hat');
    await vi.advanceTimersByTimeAsync(350);
    await nextTick();

    expect(wrapper.get('[data-test="topbar-search-hint-mobile"]').text()).toContain(
      'No books found',
    );
  });

  it('clears pending debounce timers on unmount', async () => {
    apiRequest.mockResolvedValue({ items: [] });
    const wrapper = mountSearch();

    await wrapper.get('[data-test="topbar-search-input"]').setValue('hat');
    wrapper.unmount();
    await vi.advanceTimersByTimeAsync(350);
    await nextTick();

    expect(apiRequest).not.toHaveBeenCalled();
  });

  it('adding a global item imports and adds without navigating, keeping query/results visible', async () => {
    apiRequest
      .mockResolvedValueOnce({
        items: [
          {
            work_key: '/works/OL2W',
            title: 'The Hat',
            author_names: ['Someone'],
            first_publish_year: 2000,
            cover_url: null,
          },
        ],
      })
      .mockResolvedValueOnce({ work: { id: 'work-imported' } })
      .mockResolvedValueOnce({ created: true });

    const wrapper = mountSearch();
    await wrapper.get('[data-test="scope-global"]').trigger('click');

    await wrapper.get('[data-test="topbar-search-input"]').setValue('hat');
    await vi.advanceTimersByTimeAsync(350);
    await nextTick();

    await wrapper.get('[data-test="topbar-search-add-/works/OL2W"]').trigger('click');
    await nextTick();

    expect(apiRequest).toHaveBeenCalledWith('/api/v1/books/import', expect.anything());
    expect(apiRequest).toHaveBeenCalledWith('/api/v1/library/items', expect.anything());
    expect(navigateToMock).not.toHaveBeenCalled();

    expect(
      (wrapper.get('[data-test="topbar-search-input"]').element as HTMLInputElement).value,
    ).toBe('hat');
    expect(wrapper.get('[data-test="topbar-search-results"]').exists()).toBe(true);
    expect(
      wrapper.get('[data-test="topbar-search-add-/works/OL2W"]').attributes('disabled'),
    ).toBeDefined();
  });

  it('does not re-add an already added item (early return)', async () => {
    apiRequest
      .mockResolvedValueOnce({
        items: [
          {
            work_key: '/works/OL2W',
            title: 'The Hat',
            author_names: ['Someone'],
            first_publish_year: 2000,
            cover_url: null,
          },
        ],
      })
      .mockResolvedValueOnce({ work: { id: 'work-imported' } })
      .mockResolvedValueOnce({ created: true });

    const wrapper = mountSearch();
    await wrapper.get('[data-test="scope-global"]').trigger('click');
    await wrapper.get('[data-test="topbar-search-input"]').setValue('hat');
    await vi.advanceTimersByTimeAsync(350);
    await nextTick();

    await wrapper.get('[data-test="topbar-search-add-/works/OL2W"]').trigger('click');
    await nextTick();

    const callsAfterFirstAdd = apiRequest.mock.calls.length;
    // Call the action directly to cover the early-return branch regardless of button disabled state.
    await (wrapper.vm as any).addOpenLibraryItem({
      kind: 'openlibrary',
      source: 'openlibrary',
      source_id: '/works/OL2W',
      work_key: '/works/OL2W',
      title: 'The Hat',
      author_names: ['Someone'],
      first_publish_year: 2000,
      cover_url: null,
    });
    await nextTick();
    expect(apiRequest.mock.calls.length).toBe(callsAfterFirstAdd);
  });

  it('sends quick filter params with global search', async () => {
    apiRequest.mockResolvedValueOnce({ items: [] });
    const wrapper = mountSearch();
    await wrapper.get('[data-test="scope-global"]').trigger('click');
    await wrapper.get('[data-test="topbar-search-language"]').setValue('eng');
    await wrapper.get('[data-test="topbar-search-year-from"]').setValue('1990');
    await wrapper.get('[data-test="topbar-search-year-to"]').setValue('2000');
    await wrapper.get('[data-test="topbar-search-input"]').setValue('hat');
    await vi.advanceTimersByTimeAsync(350);
    await nextTick();

    expect(apiRequest).toHaveBeenCalledWith('/api/v1/books/search', {
      query: {
        query: 'hat',
        limit: 10,
        page: 1,
        language: 'eng',
        first_publish_year_from: 1990,
        first_publish_year_to: 2000,
      },
    });
  });

  it('supports mobile quick filters and sanitizes language arrays', async () => {
    apiRequest.mockResolvedValueOnce({
      items: [
        {
          work_key: '/works/OL2W',
          title: 'The Hat',
          author_names: ['Someone'],
          first_publish_year: 2000,
          cover_url: null,
          languages: ['eng', 1, null],
        },
      ],
    });
    const wrapper = mountSearch();
    await wrapper.get('[data-test="topbar-search-mobile-open"]').trigger('click');
    await wrapper.get('[data-test="scope-global"]').trigger('click');
    await wrapper.get('[data-test="topbar-search-language-mobile"]').setValue('spa');
    await wrapper.get('[data-test="topbar-search-year-from-mobile"]').setValue('1980');
    await wrapper.get('[data-test="topbar-search-year-to-mobile"]').setValue('1990');
    await wrapper.get('[data-test="topbar-search-input-mobile"]').setValue('hat');
    await vi.advanceTimersByTimeAsync(350);
    await nextTick();

    expect(apiRequest).toHaveBeenCalledWith('/api/v1/books/search', {
      query: {
        query: 'hat',
        limit: 10,
        page: 1,
        language: 'spa',
        first_publish_year_from: 1980,
        first_publish_year_to: 1990,
      },
    });
  });

  it('renders google books results and imports with source_id', async () => {
    apiRequest.mockImplementation(async (path: string) => {
      if (path === '/api/v1/books/search') {
        return {
          items: [
            {
              source: 'googlebooks',
              source_id: 'gb1',
              work_key: 'googlebooks:gb1',
              title: 'Google Book',
              author_names: ['G Author'],
              first_publish_year: 2001,
              cover_url: null,
              attribution: {
                text: 'Data provided by Google Books',
                url: 'https://books.google.com',
              },
            },
          ],
        };
      }
      if (path === '/api/v1/books/import') return { work: { id: 'work-1' } };
      if (path === '/api/v1/library/items') return { created: true };
      throw new Error(`unexpected call: ${path}`);
    });

    const wrapper = mountSearch();
    await wrapper.get('[data-test="scope-global"]').trigger('click');
    await wrapper.get('[data-test="topbar-search-input"]').setValue('google');
    await vi.advanceTimersByTimeAsync(350);
    await nextTick();

    expect(wrapper.text()).toContain('Google Books');
    expect(wrapper.text()).toContain('Data provided by Google Books');

    await wrapper.get('[data-test="topbar-search-add-googlebooks:gb1"]').trigger('click');
    expect(apiRequest).toHaveBeenCalledWith('/api/v1/books/import', {
      method: 'POST',
      body: { source: 'googlebooks', source_id: 'gb1' },
    });
  });

  it('handles google items with malformed attribution payload', async () => {
    apiRequest.mockResolvedValueOnce({
      items: [
        {
          source: 'googlebooks',
          source_id: 'gb2',
          work_key: 'googlebooks:gb2',
          title: 'Google Book',
          author_names: ['G Author'],
          first_publish_year: 2001,
          cover_url: null,
          edition_count: 'x',
          attribution: { text: 123, url: 1 },
        },
      ],
    });

    const wrapper = mountSearch();
    await wrapper.get('[data-test="scope-global"]').trigger('click');
    await wrapper.get('[data-test="topbar-search-input"]').setValue('google');
    await vi.advanceTimersByTimeAsync(350);
    await nextTick();

    expect(wrapper.text()).toContain('Google Books');
    expect(wrapper.text()).not.toContain('Data provided by Google Books');
  });

  it('normalizes google fallback fields when optional metadata is malformed', async () => {
    apiRequest.mockResolvedValueOnce({
      items: [
        {
          source: 'googlebooks',
          work_key: 'googlebooks:gb3',
          title: 'Google Book',
          author_names: null,
          first_publish_year: '2001',
          cover_url: null,
          attribution: { text: 'From Google Books', url: 123 },
        },
      ],
    });

    const wrapper = mountSearch();
    await wrapper.get('[data-test="scope-global"]').trigger('click');
    await wrapper.get('[data-test="topbar-search-input"]').setValue('google');
    await vi.advanceTimersByTimeAsync(350);
    await nextTick();

    expect(wrapper.text()).toContain('Unknown author');
    expect(wrapper.text()).toContain('From Google Books');
    expect(wrapper.text()).not.toContain('First published:');
  });

  it('adds a book without dispatching when window is unavailable', async () => {
    const wrapper = mountSearch();
    const originalWindow = (globalThis as any).window;
    Object.defineProperty(globalThis, 'window', { value: undefined, configurable: true });
    try {
      apiRequest
        .mockResolvedValueOnce({ work: { id: 'work-imported' } })
        .mockResolvedValueOnce({ created: true });
      await (wrapper.vm as any).addOpenLibraryItem({
        kind: 'openlibrary',
        source: 'openlibrary',
        source_id: '/works/OL2W',
        work_key: '/works/OL2W',
        title: 'The Hat',
        author_names: ['Someone'],
        first_publish_year: 2000,
        cover_url: null,
      });
      expect(apiRequest).toHaveBeenCalledWith('/api/v1/books/import', {
        method: 'POST',
        body: { source: 'openlibrary', work_key: '/works/OL2W' },
      });
    } finally {
      Object.defineProperty(globalThis, 'window', { value: originalWindow, configurable: true });
    }
  });
});
