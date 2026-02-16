import { flushPromises, mount } from '@vue/test-utils';
import PrimeVue from 'primevue/config';
import Badge from 'primevue/badge';
import Column from 'primevue/column';
import DataTable from 'primevue/datatable';
import DataView from 'primevue/dataview';
import Image from 'primevue/image';
import MultiSelect from 'primevue/multiselect';
import Rating from 'primevue/rating';
import SelectButton from 'primevue/selectbutton';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  route: { fullPath: '/library' },
}));

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

vi.mock('#imports', () => ({
  useRoute: () => state.route,
}));

import LibraryPage from '../../../app/pages/library/index.vue';

const installLocalStorageMock = () => {
  const storage: Record<string, string> = {};
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => (key in storage ? storage[key] : null),
      setItem: (key: string, value: string) => {
        storage[key] = String(value);
      },
      removeItem: (key: string) => {
        delete storage[key];
      },
      clear: () => {
        Object.keys(storage).forEach((key) => delete storage[key]);
      },
    },
  });
};

const mountPage = () =>
  mount(LibraryPage, {
    global: {
      plugins: [[PrimeVue, { ripple: false }]],
      components: {
        Badge,
        Column,
        DataTable,
        DataView,
        Image,
        MultiSelect,
        Rating,
        SelectButton,
      },
      stubs: {
        NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
        Dialog: {
          name: 'Dialog',
          props: ['visible', 'header'],
          emits: ['update:visible'],
          template: '<div v-if="visible" v-bind="$attrs"><slot /></div>',
        },
        Inplace: {
          props: ['disabled'],
          data: () => ({ active: false }),
          methods: {
            open() {
              if (this.disabled) return;
              this.active = true;
            },
            close() {
              this.active = false;
            },
          },
          template: `<div v-bind="$attrs">
            <div v-if="!active" @click="open"><slot name="display" /></div>
            <div v-else><slot name="content" :closeCallback="close" /></div>
          </div>`,
        },
        Tag: {
          props: ['value'],
          template: '<span v-bind="$attrs">{{ value }}</span>',
        },
        Select: {
          props: ['modelValue', 'options', 'optionLabel', 'optionValue'],
          emits: ['update:modelValue'],
          template: `<button
            v-bind="$attrs"
            data-test="select-stub"
            @click="
              $emit(
                'update:modelValue',
                $attrs['data-test'] === 'library-sort-select'
                  ? 'title_asc'
                  : $attrs['data-test'] === 'library-status-filter'
                    ? 'reading'
                    : $attrs['data-test'] === 'library-visibility-filter'
                      ? 'public'
                      : $attrs['data-test'] === 'library-item-status-edit'
                        ? 'completed'
                        : 'public',
              )
            "
          ></button>`,
        },
        DatePicker: {
          props: ['modelValue'],
          emits: ['update:modelValue'],
          template: `<button
            v-bind="$attrs"
            data-test="datepicker-stub"
            @click="$emit('update:modelValue', new Date('2026-02-15T00:00:00.000Z'))"
          ></button>`,
        },
        InputText: {
          props: ['modelValue', 'placeholder'],
          emits: ['update:modelValue'],
          template: `<input
            v-bind="$attrs"
            :value="modelValue"
            :placeholder="placeholder"
            @input="$emit('update:modelValue', $event.target.value)"
          />`,
        },
        Paginator: {
          props: ['first', 'rows', 'totalRecords', 'rowsPerPageOptions'],
          emits: ['page'],
          template: `<button v-bind="$attrs" @click="$emit('page', { page: 1, rows: 25 })" />`,
        },
      },
    },
  });

describe('library page', () => {
  beforeEach(() => {
    installLocalStorageMock();
    apiRequest.mockReset();
    toastAdd.mockReset();
    state.route = { fullPath: '/library' };
    globalThis.localStorage?.clear();
  });

  it('loads library items on mount', async () => {
    apiRequest.mockResolvedValueOnce({
      items: [
        {
          id: 'item-1',
          work_id: 'work-1',
          work_title: 'Book A',
          author_names: ['Author A'],
          cover_url: 'https://example.com/cover.jpg',
          status: 'to_read',
          visibility: 'private',
          tags: ['Favorites'],
          created_at: '2026-02-08T00:00:00Z',
        },
      ],
      next_cursor: null,
    });

    const wrapper = mountPage();
    await flushPromises();

    expect(apiRequest).toHaveBeenCalledWith('/api/v1/library/items', {
      query: {
        page: 1,
        page_size: 25,
        sort: 'newest',
        status: undefined,
        visibility: undefined,
        tag: undefined,
      },
    });
    expect(wrapper.text()).toContain('Book A');
    expect(wrapper.findAll('[data-test="library-item-cover"]').length).toBeGreaterThan(0);
  });

  it('loads next page when paginator page changes', async () => {
    apiRequest
      .mockResolvedValueOnce({
        items: [
          {
            id: 'item-1',
            work_id: 'work-1',
            work_title: 'Book A',
            author_names: [],
            cover_url: 'https://example.com/cover.jpg',
            status: 'to_read',
            visibility: 'private',
            tags: ['Favorites'],
            created_at: '2026-02-08T00:00:00Z',
          },
        ],
        pagination: {
          page: 1,
          page_size: 25,
          total_count: 40,
          total_pages: 2,
          from: 1,
          to: 25,
          has_prev: false,
          has_next: true,
        },
      })
      .mockResolvedValueOnce({
        items: [
          {
            id: 'item-2',
            work_id: 'work-2',
            work_title: 'Book B',
            author_names: [],
            cover_url: null,
            status: 'reading',
            visibility: 'private',
            tags: ['SciFi'],
            created_at: '2026-02-09T00:00:00Z',
          },
        ],
        pagination: {
          page: 2,
          page_size: 25,
          total_count: 40,
          total_pages: 2,
          from: 26,
          to: 40,
          has_prev: true,
          has_next: false,
        },
      });

    const wrapper = mountPage();
    await flushPromises();
    await wrapper.get('[data-test="library-paginator"]').trigger('click');
    await flushPromises();

    expect(apiRequest).toHaveBeenNthCalledWith(2, '/api/v1/library/items', {
      query: {
        page: 2,
        page_size: 25,
        sort: 'newest',
        status: undefined,
        visibility: undefined,
        tag: undefined,
      },
    });
    expect(wrapper.text()).toContain('Book B');
    expect(wrapper.findAll('[data-test="library-item-cover-placeholder"]').length).toBeGreaterThan(
      0,
    );
  });

  it('shows empty state when no items are returned', async () => {
    apiRequest.mockResolvedValueOnce({ items: [], next_cursor: null });

    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.get('[data-test="library-empty"]').text()).toContain('No library items');
  });

  it('shows api client errors on fetch', async () => {
    apiRequest.mockRejectedValueOnce(
      new ApiClientErrorMock('Sign in required', 'auth_required', 401),
    );

    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.get('[data-test="library-error"]').text()).toContain('Sign in required');
  });

  it('shows generic errors on fetch', async () => {
    apiRequest.mockRejectedValueOnce(new Error('boom'));

    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.get('[data-test="library-error"]').text()).toContain('Unable to load library');
  });

  it('refetches when status filter changes', async () => {
    apiRequest
      .mockResolvedValueOnce({ items: [], next_cursor: null })
      .mockResolvedValueOnce({ items: [], next_cursor: null });

    const wrapper = mountPage();
    await flushPromises();
    await wrapper.get('[data-test="library-status-filter"]').trigger('click');
    await flushPromises();

    expect(apiRequest).toHaveBeenNthCalledWith(2, '/api/v1/library/items', {
      query: {
        page: 1,
        page_size: 25,
        sort: 'newest',
        status: 'reading',
        visibility: undefined,
        tag: undefined,
      },
    });
  });

  it('refetches when visibility filter changes', async () => {
    apiRequest
      .mockResolvedValueOnce({ items: [], next_cursor: null })
      .mockResolvedValueOnce({ items: [], next_cursor: null });

    const wrapper = mountPage();
    await flushPromises();
    await wrapper.get('[data-test="library-visibility-filter"]').trigger('click');
    await flushPromises();

    expect(apiRequest).toHaveBeenNthCalledWith(2, '/api/v1/library/items', {
      query: {
        page: 1,
        page_size: 25,
        sort: 'newest',
        status: undefined,
        visibility: 'public',
        tag: undefined,
      },
    });
  });

  it('refetches when a library-updated event is dispatched', async () => {
    apiRequest
      .mockResolvedValueOnce({ items: [], next_cursor: null })
      .mockResolvedValueOnce({ items: [], next_cursor: null });

    mountPage();
    await flushPromises();

    window.dispatchEvent(new Event('chapterverse:library-updated'));
    await flushPromises();

    expect(apiRequest).toHaveBeenNthCalledWith(2, '/api/v1/library/items', {
      query: {
        page: 1,
        page_size: 25,
        sort: 'newest',
        status: undefined,
        visibility: undefined,
        tag: undefined,
      },
    });
  });

  it('registers and removes the library-updated event listener on mount/unmount', async () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    apiRequest.mockResolvedValueOnce({ items: [], next_cursor: null });

    const wrapper = mountPage();
    await flushPromises();
    wrapper.unmount();

    expect(addSpy).toHaveBeenCalledWith('chapterverse:library-updated', expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith('chapterverse:library-updated', expect.any(Function));
  });

  it('renders view mode selector with all three options', async () => {
    apiRequest.mockResolvedValueOnce({ items: [], next_cursor: null });

    const wrapper = mountPage();
    await flushPromises();

    const viewSelect = wrapper.get('[data-test="library-view-select"]');
    expect(viewSelect.text()).toContain('List');
    expect(viewSelect.text()).toContain('Grid');
    expect(viewSelect.text()).toContain('Table');
    expect((wrapper.vm as any).viewMode).toBe('current');
  });

  it('updates view mode via SelectButton v-model event', async () => {
    apiRequest.mockResolvedValueOnce({ items: [], next_cursor: null });

    const wrapper = mountPage();
    await flushPromises();

    const selectButton = wrapper.findComponent(SelectButton);
    selectButton.vm.$emit('update:modelValue', 'grid');
    await flushPromises();

    expect((wrapper.vm as any).viewMode).toBe('grid');
  });

  it('restores persisted view mode from localStorage', async () => {
    if (globalThis.localStorage && typeof globalThis.localStorage.setItem === 'function') {
      globalThis.localStorage.setItem('seedbed.library.viewMode', 'table');
    }
    apiRequest.mockResolvedValueOnce({ items: [], next_cursor: null });

    const wrapper = mountPage();
    await flushPromises();

    expect((wrapper.vm as any).viewMode).toBe('table');
  });

  it('falls back to current view when persisted view mode is invalid', async () => {
    if (globalThis.localStorage && typeof globalThis.localStorage.setItem === 'function') {
      globalThis.localStorage.setItem('seedbed.library.viewMode', 'bad-value');
    }
    apiRequest.mockResolvedValueOnce({ items: [], next_cursor: null });

    const wrapper = mountPage();
    await flushPromises();

    expect((wrapper.vm as any).viewMode).toBe('current');
  });

  it('persists view mode changes', async () => {
    apiRequest.mockResolvedValueOnce({ items: [], next_cursor: null });

    const wrapper = mountPage();
    await flushPromises();

    (wrapper.vm as any).viewMode = 'grid';
    await flushPromises();

    if (globalThis.localStorage && typeof globalThis.localStorage.getItem === 'function') {
      expect(globalThis.localStorage.getItem('seedbed.library.viewMode')).toBe('grid');
    }
  });

  it('uses curated default table columns when storage is empty', async () => {
    apiRequest.mockResolvedValueOnce({ items: [], next_cursor: null });

    const wrapper = mountPage();
    await flushPromises();

    expect((wrapper.vm as any).tableColumns).toEqual([
      'cover',
      'title',
      'author',
      'status',
      'description',
      'rating',
      'tags',
      'added',
    ]);
  });

  it('restores persisted table columns from localStorage', async () => {
    if (globalThis.localStorage && typeof globalThis.localStorage.setItem === 'function') {
      globalThis.localStorage.setItem(
        'seedbed.library.tableColumns',
        JSON.stringify(['title', 'author', 'last_read', 'added']),
      );
    }
    apiRequest.mockResolvedValueOnce({ items: [], next_cursor: null });

    const wrapper = mountPage();
    await flushPromises();

    expect((wrapper.vm as any).tableColumns).toEqual(['title', 'author', 'last_read', 'added']);
  });

  it('falls back to default table columns when persisted columns are invalid', async () => {
    if (globalThis.localStorage && typeof globalThis.localStorage.setItem === 'function') {
      globalThis.localStorage.setItem('seedbed.library.tableColumns', JSON.stringify(['invalid']));
    }
    apiRequest.mockResolvedValueOnce({ items: [], next_cursor: null });

    const wrapper = mountPage();
    await flushPromises();

    expect((wrapper.vm as any).tableColumns).toEqual([
      'cover',
      'title',
      'author',
      'status',
      'description',
      'rating',
      'tags',
      'added',
    ]);
  });

  it('persists table columns when changed', async () => {
    apiRequest.mockResolvedValueOnce({ items: [], next_cursor: null });

    const wrapper = mountPage();
    await flushPromises();

    (wrapper.vm as any).tableColumns = ['title', 'added'];
    await flushPromises();

    if (globalThis.localStorage && typeof globalThis.localStorage.getItem === 'function') {
      expect(globalThis.localStorage.getItem('seedbed.library.tableColumns')).toBe(
        JSON.stringify(['title', 'added']),
      );
    }
  });

  it('defaults to current when localStorage.getItem is unavailable', async () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {},
    });
    apiRequest.mockResolvedValueOnce({ items: [], next_cursor: null });

    const wrapper = mountPage();
    await flushPromises();

    expect((wrapper.vm as any).viewMode).toBe('current');
  });

  it('defaults to current when reading persisted view mode throws', async () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: () => {
          throw new Error('storage read error');
        },
      },
    });
    apiRequest.mockResolvedValueOnce({ items: [], next_cursor: null });

    const wrapper = mountPage();
    await flushPromises();

    expect((wrapper.vm as any).viewMode).toBe('current');
  });

  it('ignores storage write when setItem is unavailable', async () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: () => 'current',
      },
    });
    apiRequest.mockResolvedValueOnce({ items: [], next_cursor: null });

    const wrapper = mountPage();
    await flushPromises();

    expect(() => {
      (wrapper.vm as any).viewMode = 'grid';
    }).not.toThrow();
  });

  it('ignores storage write errors when persisting view mode', async () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: () => 'current',
        setItem: () => {
          throw new Error('storage write error');
        },
      },
    });
    apiRequest.mockResolvedValueOnce({ items: [], next_cursor: null });

    const wrapper = mountPage();
    await flushPromises();

    expect(() => {
      (wrapper.vm as any).viewMode = 'grid';
    }).not.toThrow();
  });

  it('filters by tag substring (case-insensitive)', async () => {
    apiRequest.mockResolvedValueOnce({
      items: [
        {
          id: 'item-1',
          work_id: 'work-1',
          work_title: 'Book A',
          author_names: [],
          cover_url: null,
          status: 'to_read',
          visibility: 'private',
          tags: ['Favorites', '2026'],
          created_at: '2026-02-08T00:00:00Z',
        },
        {
          id: 'item-2',
          work_id: 'work-2',
          work_title: 'Book B',
          author_names: [],
          cover_url: null,
          status: 'reading',
          visibility: 'private',
          tags: ['SciFi'],
          created_at: '2026-02-09T00:00:00Z',
        },
        {
          id: 'item-3',
          work_id: 'work-3',
          work_title: 'Book C',
          author_names: [],
          cover_url: null,
          status: 'reading',
          visibility: 'private',
          tags: undefined,
          created_at: '2026-02-10T00:00:00Z',
        },
      ],
      next_cursor: null,
    });

    const wrapper = mountPage();
    await flushPromises();

    await wrapper.get('[data-test="library-tag-filter"]').setValue('fAv');
    await flushPromises();

    expect(wrapper.text()).toContain('Book A');
    expect(wrapper.text()).not.toContain('Book B');
    expect(wrapper.text()).not.toContain('Book C');
  });

  it('sorts by title A-Z when selected', async () => {
    apiRequest.mockResolvedValueOnce({
      items: [
        {
          id: 'item-1',
          work_id: 'work-1',
          work_title: 'Zoo Book',
          cover_url: null,
          status: 'to_read',
          visibility: 'private',
          tags: [],
          created_at: '2026-02-08T00:00:00Z',
        },
        {
          id: 'item-2',
          work_id: 'work-2',
          work_title: 'Alpha Book',
          cover_url: null,
          status: 'reading',
          visibility: 'private',
          tags: [],
          created_at: '2026-02-09T00:00:00Z',
        },
      ],
      next_cursor: null,
    });

    const wrapper = mountPage();
    await flushPromises();

    await wrapper.get('[data-test="library-sort-select"]').trigger('click');
    await flushPromises();

    const items = wrapper.get('[data-test="library-items"]').findAll('a');
    const titles = items.map((a) => a.text());
    expect(titles[0]).toContain('Alpha Book');
    expect(titles[1]).toContain('Zoo Book');
  });

  it('renders table columns and supports table header sorting', async () => {
    apiRequest.mockResolvedValueOnce({
      items: [
        {
          id: 'item-1',
          work_id: 'work-1',
          work_title: 'Zoo Book',
          work_description: 'Zoo description',
          author_names: ['Zed Author'],
          cover_url: null,
          status: 'to_read',
          visibility: 'private',
          rating: 4,
          friend_recommendations_count: 2,
          tags: ['Favorites'],
          created_at: '2026-02-08T00:00:00Z',
        },
        {
          id: 'item-2',
          work_id: 'work-2',
          work_title: 'Alpha Book',
          work_description: 'Alpha description',
          author_names: ['Alice Author'],
          cover_url: null,
          status: 'reading',
          visibility: 'private',
          rating: 3,
          friend_recommendations_count: null,
          tags: [],
          created_at: '2026-02-09T00:00:00Z',
        },
      ],
      next_cursor: null,
    });

    const wrapper = mountPage();
    await flushPromises();

    (wrapper.vm as any).viewMode = 'table';
    await flushPromises();

    expect(wrapper.text()).toContain('Status');
    expect(wrapper.text()).toContain('Rating');
    expect(wrapper.text()).toContain('Tags');
    expect(wrapper.text()).not.toContain('Friends recs');
    expect(wrapper.text()).toContain('Added');
    expect(wrapper.text()).toContain('Actions');
    expect(wrapper.text()).toContain('Zoo description');

    (wrapper.vm as any).tableColumns = [
      'title',
      'author',
      'status',
      'rating',
      'recommendations',
      'added',
    ];
    await flushPromises();
    expect(wrapper.text()).toContain('Friends recs');
    expect(wrapper.text()).toContain('2 recs');

    await wrapper.get('[data-test="library-table-sort-title"]').trigger('click');
    await flushPromises();
    expect((wrapper.vm as any).sortMode).toBe('title_asc');
    let items = wrapper.findAll('[data-test="library-item-title-link"]');
    expect(items[0]?.text()).toContain('Alpha Book');

    await wrapper.get('[data-test="library-table-sort-title"]').trigger('click');
    await flushPromises();
    expect((wrapper.vm as any).sortMode).toBe('title_desc');
    items = wrapper.findAll('[data-test="library-item-title-link"]');
    expect(items[0]?.text()).toContain('Zoo Book');

    await wrapper.get('[data-test="library-table-sort-author"]').trigger('click');
    await flushPromises();
    expect((wrapper.vm as any).sortMode).toBe('author_asc');
    items = wrapper.findAll('[data-test="library-item-title-link"]');
    expect(items[0]?.text()).toContain('Alpha Book');

    await wrapper.get('[data-test="library-table-sort-status"]').trigger('click');
    await flushPromises();
    expect((wrapper.vm as any).sortMode).toBe('status_asc');
    items = wrapper.findAll('[data-test="library-item-title-link"]');
    expect(items[0]?.text()).toContain('Alpha Book');

    await wrapper.get('[data-test="library-table-sort-rating"]').trigger('click');
    await flushPromises();
    expect((wrapper.vm as any).sortMode).toBe('rating_asc');
    items = wrapper.findAll('[data-test="library-item-title-link"]');
    expect(items[0]?.text()).toContain('Alpha Book');

    (wrapper.vm as any).sortMode = 'newest';
    (wrapper.vm as any).toggleAddedSort();
    await flushPromises();
    expect((wrapper.vm as any).sortMode).toBe('oldest');

    (wrapper.vm as any).tableColumns = ['title', 'author', 'added'];
    await flushPromises();
    expect(wrapper.text()).not.toContain('Status');
  });

  it('shows columns picker in table mode only', async () => {
    apiRequest.mockResolvedValueOnce({ items: [], next_cursor: null });

    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.find('[data-test="library-columns-select"]').exists()).toBe(false);
    (wrapper.vm as any).viewMode = 'table';
    await flushPromises();
    expect(wrapper.find('[data-test="library-columns-select"]').exists()).toBe(true);
  });

  it('renders columns picker on initial mount when persisted view mode is table', async () => {
    if (globalThis.localStorage && typeof globalThis.localStorage.setItem === 'function') {
      globalThis.localStorage.setItem('seedbed.library.viewMode', 'table');
    }
    apiRequest.mockResolvedValueOnce({ items: [], next_cursor: null });

    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.find('[data-test="library-columns-select"]').exists()).toBe(true);
  });

  it('updates table columns via MultiSelect v-model event', async () => {
    apiRequest.mockResolvedValueOnce({ items: [], next_cursor: null });

    const wrapper = mountPage();
    await flushPromises();

    (wrapper.vm as any).viewMode = 'table';
    await flushPromises();

    const multiSelect = wrapper.findComponent(MultiSelect);
    multiSelect.vm.$emit('update:modelValue', ['title', 'added']);
    await flushPromises();

    expect((wrapper.vm as any).tableColumns).toEqual(['title', 'added']);
  });

  it('renders last read column when enabled', async () => {
    apiRequest.mockResolvedValueOnce({
      items: [
        {
          id: 'item-1',
          work_id: 'work-1',
          work_title: 'Last Read Book',
          work_description: 'Description',
          cover_url: null,
          status: 'reading',
          visibility: 'private',
          rating: 7,
          tags: [],
          last_read_at: '2026-02-11T00:00:00Z',
          created_at: '2026-02-09T00:00:00Z',
        },
      ],
      next_cursor: null,
    });

    const wrapper = mountPage();
    await flushPromises();

    (wrapper.vm as any).viewMode = 'table';
    (wrapper.vm as any).tableColumns = ['title', 'last_read', 'added'];
    await flushPromises();

    expect(wrapper.text()).toContain('Last read');
    expect(wrapper.text()).toContain((wrapper.vm as any).formatLastReadAt('2026-02-11T00:00:00Z'));
  });

  it('returns fallback date glyph and icon defaults for non-matching sort modes', async () => {
    apiRequest.mockResolvedValueOnce({ items: [], next_cursor: null });

    const wrapper = mountPage();
    await flushPromises();

    expect((wrapper.vm as any).formatCreatedAt()).toBe('—');
    expect((wrapper.vm as any).formatCreatedAt('not-a-date')).toBe('—');
    expect((wrapper.vm as any).descriptionSnippet('   ')).toBe('No description available.');
    expect((wrapper.vm as any).recommendationLabel(0)).toBe('0 recs');
    expect((wrapper.vm as any).recommendationLabel(1)).toBe('1 rec');
    expect((wrapper.vm as any).recommendationLabel(3)).toBe('3 recs');
    expect((wrapper.vm as any).ratingValue(11)).toBe(5);
    expect((wrapper.vm as any).ratingValue(-1)).toBe(0);

    (wrapper.vm as any).sortMode = 'newest';
    await flushPromises();
    expect((wrapper.vm as any).titleSortIcon).toBe('pi pi-sort-alt');

    (wrapper.vm as any).sortMode = 'title_asc';
    await flushPromises();
    expect((wrapper.vm as any).addedSortIcon).toBe('pi pi-sort-alt');

    (wrapper.vm as any).sortMode = 'newest';
    await flushPromises();
    expect((wrapper.vm as any).authorSortIcon).toBe('pi pi-sort-alt');
    expect((wrapper.vm as any).statusSortIcon).toBe('pi pi-sort-alt');
    expect((wrapper.vm as any).ratingSortIcon).toBe('pi pi-sort-alt');
  });

  it('covers extended table sort modes and toggle helpers', async () => {
    apiRequest.mockResolvedValueOnce({
      items: [
        {
          id: 'item-1',
          work_id: 'work-1',
          work_title: 'Gamma',
          author_names: ['Zed'],
          cover_url: null,
          status: 'to_read',
          visibility: 'private',
          rating: null,
          tags: [],
          created_at: '2026-02-08T00:00:00Z',
        },
        {
          id: 'item-2',
          work_id: 'work-2',
          work_title: 'Beta',
          author_names: ['Alice'],
          cover_url: null,
          status: 'completed',
          visibility: 'private',
          rating: 9,
          tags: [],
          created_at: '2026-02-09T00:00:00Z',
        },
        {
          id: 'item-3',
          work_id: 'work-3',
          work_title: 'Alpha',
          author_names: undefined,
          cover_url: null,
          status: 'reading',
          visibility: 'private',
          rating: 3,
          tags: [],
          created_at: '2026-02-10T00:00:00Z',
        },
      ],
      next_cursor: null,
    });

    const wrapper = mountPage();
    await flushPromises();

    (wrapper.vm as any).sortMode = 'author_desc';
    await flushPromises();
    expect((wrapper.vm as any).displayItems[0].work_title).toBe('Gamma');

    (wrapper.vm as any).sortMode = 'status_desc';
    await flushPromises();
    expect((wrapper.vm as any).displayItems[0].status).toBe('to_read');

    (wrapper.vm as any).sortMode = 'rating_desc';
    await flushPromises();
    expect((wrapper.vm as any).displayItems[0].work_title).toBe('Beta');

    (wrapper.vm as any).sortMode = 'rating_asc';
    await flushPromises();
    expect((wrapper.vm as any).displayItems[0].work_title).toBe('Alpha');

    (wrapper.vm as any).toggleAuthorSort();
    await flushPromises();
    expect((wrapper.vm as any).sortMode).toBe('author_asc');
    (wrapper.vm as any).toggleAuthorSort();
    await flushPromises();
    expect((wrapper.vm as any).sortMode).toBe('author_desc');

    (wrapper.vm as any).toggleStatusSort();
    await flushPromises();
    expect((wrapper.vm as any).sortMode).toBe('status_asc');
    (wrapper.vm as any).toggleStatusSort();
    await flushPromises();
    expect((wrapper.vm as any).sortMode).toBe('status_desc');

    (wrapper.vm as any).toggleRatingSort();
    await flushPromises();
    expect((wrapper.vm as any).sortMode).toBe('rating_asc');
    (wrapper.vm as any).toggleRatingSort();
    await flushPromises();
    expect((wrapper.vm as any).sortMode).toBe('rating_desc');
  });

  it('covers comparator map and helper branches used by table sorting', async () => {
    apiRequest.mockResolvedValueOnce({ items: [], next_cursor: null });

    const wrapper = mountPage();
    await flushPromises();

    const vm = wrapper.vm as any;
    expect(vm.formatLastReadAt(null)).toBe('—');
    expect(vm.formatLastReadAt('2026-02-11T00:00:00Z')).toBe(
      vm.formatCreatedAt('2026-02-11T00:00:00Z'),
    );
    expect(vm.ratingLabel(undefined)).toBe('No rating');
    expect(vm.ratingLabel(8)).toBe('8/10');

    const a = {
      created_at: '2026-02-09T00:00:00Z',
      work_title: 'A',
      author_names: ['Author A'],
      status: 'reading',
      rating: 4,
    };
    const b = {
      created_at: '2026-02-08T00:00:00Z',
      work_title: 'B',
      author_names: ['Author B'],
      status: 'to_read',
      rating: null,
    };
    const c = {
      created_at: undefined,
      work_title: 'C',
      author_names: undefined,
      status: 'completed',
      rating: undefined,
    };

    expect(vm.sortComparators.newest(a, b)).toBeLessThan(0);
    expect(vm.sortComparators.oldest(a, b)).toBeGreaterThan(0);
    expect(vm.sortComparators.title_asc(a, b)).toBeLessThan(0);
    expect(vm.sortComparators.title_desc(a, b)).toBeGreaterThan(0);
    expect(vm.sortComparators.author_asc(a, b)).toBeLessThan(0);
    expect(vm.sortComparators.author_desc(a, b)).toBeGreaterThan(0);
    expect(vm.sortComparators.status_asc(a, b)).toBeLessThan(0);
    expect(vm.sortComparators.status_desc(a, b)).toBeGreaterThan(0);
    expect(vm.sortComparators.rating_asc(a, b)).toBeLessThan(0);
    expect(vm.sortComparators.rating_desc(a, b)).toBeLessThan(0);

    expect(vm.sortComparators.newest(c, b)).toBeGreaterThan(0);
    expect(vm.sortComparators.oldest(c, b)).toBeLessThan(0);
    expect(vm.sortComparators.author_asc(c, b)).toBeGreaterThan(0);
    expect(vm.sortComparators.author_desc(c, b)).toBeLessThan(0);
    expect(vm.sortComparators.rating_asc(c, b)).toBe(0);
    expect(vm.sortComparators.rating_desc(c, b)).toBe(0);

    vm.sortMode = 'rating_desc';
    await flushPromises();
    expect(vm.ratingSortIcon).toBe('pi pi-sort-amount-down');
  });

  it('renders description snippets in list, grid, and table modes', async () => {
    apiRequest.mockResolvedValueOnce({
      items: [
        {
          id: 'item-1',
          work_id: 'work-1',
          work_title: 'Book With Description',
          work_description: 'A **concise** description for testing.',
          author_names: ['Author A'],
          cover_url: null,
          status: 'reading',
          visibility: 'private',
          rating: 8,
          friend_recommendations_count: null,
          tags: [],
          created_at: '2026-02-09T00:00:00Z',
        },
      ],
      next_cursor: null,
    });

    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.text()).toContain('A concise description for testing.');
    expect(wrapper.find('[data-test="library-item-description"] strong').exists()).toBe(true);
    expect(wrapper.text()).toContain('No recs');
    expect(wrapper.find('[data-test="library-item-rating"]').text()).toContain('Rating');

    (wrapper.vm as any).viewMode = 'grid';
    await flushPromises();
    expect(wrapper.find('[data-test="library-items-grid"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('A concise description for testing.');
    expect(wrapper.text()).toContain('No recs');

    (wrapper.vm as any).viewMode = 'table';
    (wrapper.vm as any).tableColumns = [
      'title',
      'author',
      'description',
      'rating',
      'recommendations',
    ];
    await flushPromises();
    expect(wrapper.find('[data-test="library-items-table"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('A concise description for testing.');
    expect(wrapper.text()).toContain('No recs');
  });

  it('escapes unsafe html in markdown descriptions', async () => {
    apiRequest.mockResolvedValueOnce({
      items: [
        {
          id: 'item-1',
          work_id: 'work-1',
          work_title: 'Unsafe Description Book',
          work_description: '<script>alert(1)</script> **bold**',
          author_names: ['Author A'],
          cover_url: null,
          status: 'reading',
          visibility: 'private',
          tags: [],
          created_at: '2026-02-09T00:00:00Z',
        },
      ],
      next_cursor: null,
    });

    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.find('[data-test="library-item-description"] script').exists()).toBe(false);
    expect(wrapper.find('[data-test="library-item-description"] strong').exists()).toBe(true);
    expect(wrapper.text()).toContain('bold');
    expect(wrapper.text()).not.toContain('alert(1)');
  });

  it('renders common html description tags from providers safely', async () => {
    apiRequest.mockResolvedValueOnce({
      items: [
        {
          id: 'item-1',
          work_id: 'work-1',
          work_title: 'HTML Description Book',
          work_description: '<b>Bold</b><br><i>Italic</i>',
          author_names: ['Author A'],
          cover_url: null,
          status: 'reading',
          visibility: 'private',
          tags: [],
          created_at: '2026-02-09T00:00:00Z',
        },
      ],
      next_cursor: null,
    });

    const wrapper = mountPage();
    await flushPromises();

    const description = wrapper.get('[data-test="library-item-description"]');
    expect(description.text()).toContain('Bold');
    expect(description.text()).toContain('Italic');
    expect(description.find('b, strong').exists()).toBe(true);
    expect(description.find('i, em').exists()).toBe(true);
    expect(description.find('script').exists()).toBe(false);
  });

  it('uses title-only link styling and keeps author/description as plain text', async () => {
    apiRequest.mockResolvedValueOnce({
      items: [
        {
          id: 'item-1',
          work_id: 'work-1',
          work_title: 'Link Styled Title',
          work_description: 'Description text',
          author_names: ['Author Link'],
          cover_url: null,
          status: 'to_read',
          visibility: 'private',
          rating: null,
          tags: ['Tag1', 'Tag2', 'Tag3'],
          created_at: '2026-02-09T00:00:00Z',
        },
      ],
      next_cursor: null,
    });

    const wrapper = mountPage();
    await flushPromises();

    const titleLink = wrapper.get('[data-test="library-item-title-link"]');
    expect(titleLink.classes()).toContain('no-underline');
    expect(wrapper.find('[data-test="library-item-description"] a').exists()).toBe(false);
    expect(wrapper.text()).toContain('+1');
  });

  it('renders grid mode and opens remove dialog from a grid card', async () => {
    apiRequest.mockResolvedValueOnce({
      items: [
        {
          id: 'item-1',
          work_id: 'work-1',
          work_title: 'Grid Book',
          author_names: ['Author A'],
          cover_url: null,
          status: 'reading',
          visibility: 'private',
          tags: ['Tag1', 'Tag2'],
          created_at: '2026-02-09T00:00:00Z',
        },
      ],
      next_cursor: null,
    });

    const wrapper = mountPage();
    await flushPromises();

    (wrapper.vm as any).viewMode = 'grid';
    await flushPromises();

    expect(wrapper.find('[data-test="library-items-grid"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('Grid Book');

    await wrapper.get('[data-test="library-item-remove"]').trigger('click');
    await flushPromises();
    expect(wrapper.find('[data-test="library-remove-dialog"]').exists()).toBe(true);
  });

  it('covers grid conditional branches for cover, author, and tags', async () => {
    apiRequest.mockResolvedValueOnce({
      items: [
        {
          id: 'item-1',
          work_id: 'work-1',
          work_title: 'Grid With Cover',
          author_names: [],
          cover_url: 'https://example.com/cover.jpg',
          status: 'reading',
          visibility: 'private',
          tags: [],
          created_at: '2026-02-09T00:00:00Z',
        },
        {
          id: 'item-2',
          work_id: 'work-2',
          work_title: 'Grid Without Cover',
          author_names: ['Author B'],
          cover_url: null,
          status: 'to_read',
          visibility: 'private',
          tags: ['Tag1', 'Tag2'],
          created_at: '2026-02-08T00:00:00Z',
        },
      ],
      next_cursor: null,
    });

    const wrapper = mountPage();
    await flushPromises();

    (wrapper.vm as any).viewMode = 'grid';
    await flushPromises();

    expect(wrapper.findAll('[data-test="library-item-cover"]').length).toBeGreaterThan(0);
    expect(wrapper.findAll('[data-test="library-item-cover-placeholder"]').length).toBeGreaterThan(
      0,
    );
    expect(wrapper.text()).toContain('Author B');
  });

  it('opens remove dialog from table mode actions', async () => {
    apiRequest.mockResolvedValueOnce({
      items: [
        {
          id: 'item-1',
          work_id: 'work-1',
          work_title: 'Table Book',
          author_names: [],
          cover_url: null,
          status: 'to_read',
          visibility: 'private',
          tags: [],
          created_at: '2026-02-09T00:00:00Z',
        },
      ],
      next_cursor: null,
    });

    const wrapper = mountPage();
    await flushPromises();

    (wrapper.vm as any).viewMode = 'table';
    await flushPromises();

    await wrapper.get('[data-test="library-item-remove"]').trigger('click');
    await flushPromises();
    expect(wrapper.find('[data-test="library-remove-dialog"]').exists()).toBe(true);
  });

  it('renders table tag fallback dash when tags are empty', async () => {
    apiRequest.mockResolvedValueOnce({
      items: [
        {
          id: 'item-1',
          work_id: 'work-1',
          work_title: 'No Tags',
          author_names: [],
          cover_url: null,
          status: 'to_read',
          visibility: 'private',
          tags: [],
          created_at: '2026-02-09T00:00:00Z',
        },
      ],
      next_cursor: null,
    });

    const wrapper = mountPage();
    await flushPromises();

    (wrapper.vm as any).viewMode = 'table';
    await flushPromises();

    expect(wrapper.text()).toContain('—');
  });

  it('sorts by oldest first when selected programmatically', async () => {
    apiRequest.mockResolvedValueOnce({
      items: [
        {
          id: 'item-1',
          work_id: 'work-1',
          work_title: 'Book A',
          cover_url: null,
          status: 'to_read',
          visibility: 'private',
          tags: [],
          created_at: '2026-02-09T00:00:00Z',
        },
        {
          id: 'item-2',
          work_id: 'work-2',
          work_title: 'Book B',
          cover_url: null,
          status: 'reading',
          visibility: 'private',
          tags: [],
          created_at: '2026-02-08T00:00:00Z',
        },
      ],
      next_cursor: null,
    });

    const wrapper = mountPage();
    await flushPromises();

    (wrapper.vm as any).sortMode = 'oldest';
    await flushPromises();

    const items = wrapper.get('[data-test="library-items"]').findAll('a');
    const titles = items.map((a) => a.text());
    expect(titles[0]).toContain('Book B');
    expect(titles[1]).toContain('Book A');
  });

  it('sorts oldest first when created_at is missing', async () => {
    apiRequest.mockResolvedValueOnce({
      items: [
        {
          id: 'item-1',
          work_id: 'work-1',
          work_title: 'Book Missing Date',
          cover_url: null,
          status: 'to_read',
          visibility: 'private',
          tags: [],
        },
        {
          id: 'item-2',
          work_id: 'work-2',
          work_title: 'Book With Date',
          cover_url: null,
          status: 'reading',
          visibility: 'private',
          tags: [],
          created_at: '2026-02-08T00:00:00Z',
        },
      ],
      next_cursor: null,
    });

    const wrapper = mountPage();
    await flushPromises();

    (wrapper.vm as any).sortMode = 'oldest';
    await flushPromises();

    const items = wrapper.get('[data-test="library-items"]').findAll('a');
    const titles = items.map((a) => a.text());
    expect(titles[0]).toContain('Book Missing Date');
    expect(titles[1]).toContain('Book With Date');
  });

  it('sorts by title Z-A when selected programmatically', async () => {
    apiRequest.mockResolvedValueOnce({
      items: [
        {
          id: 'item-1',
          work_id: 'work-1',
          work_title: 'Alpha Book',
          cover_url: null,
          status: 'to_read',
          visibility: 'private',
          tags: [],
          created_at: '2026-02-09T00:00:00Z',
        },
        {
          id: 'item-2',
          work_id: 'work-2',
          work_title: 'Zoo Book',
          cover_url: null,
          status: 'reading',
          visibility: 'private',
          tags: [],
          created_at: '2026-02-08T00:00:00Z',
        },
      ],
      next_cursor: null,
    });

    const wrapper = mountPage();
    await flushPromises();

    (wrapper.vm as any).sortMode = 'title_desc';
    await flushPromises();

    const items = wrapper.get('[data-test="library-items"]').findAll('a');
    const titles = items.map((a) => a.text());
    expect(titles[0]).toContain('Zoo Book');
    expect(titles[1]).toContain('Alpha Book');
  });

  it('sorts even when created_at is missing (covers created_at fallback branches)', async () => {
    apiRequest.mockResolvedValueOnce({
      items: [
        {
          id: 'item-1',
          work_id: 'work-1',
          work_title: 'Book A',
          cover_url: null,
          status: 'to_read',
          visibility: 'private',
          tags: [],
          created_at: undefined,
        },
        {
          id: 'item-2',
          work_id: 'work-2',
          work_title: 'Book B',
          cover_url: null,
          status: 'reading',
          visibility: 'private',
          tags: [],
          created_at: '2026-02-08T00:00:00Z',
        },
      ],
      next_cursor: null,
    });

    const wrapper = mountPage();
    await flushPromises();

    const items = wrapper.get('[data-test="library-items"]').findAll('a');
    const titles = items.map((a) => a.text());
    expect(titles[0]).toContain('Book B');
  });

  it('handles newest-first sorting when all created_at values are missing', async () => {
    apiRequest.mockResolvedValueOnce({
      items: [
        {
          id: 'item-1',
          work_id: 'work-1',
          work_title: 'Book A',
          cover_url: null,
          status: 'to_read',
          visibility: 'private',
          tags: [],
          created_at: undefined,
        },
        {
          id: 'item-2',
          work_id: 'work-2',
          work_title: 'Book B',
          cover_url: null,
          status: 'reading',
          visibility: 'private',
          tags: [],
          created_at: undefined,
        },
      ],
      next_cursor: null,
    });

    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.text()).toContain('Book A');
    expect(wrapper.text()).toContain('Book B');
  });

  it('handles oldest-first sorting when created_at values are missing', async () => {
    apiRequest.mockResolvedValueOnce({
      items: [
        {
          id: 'item-1',
          work_id: 'work-1',
          work_title: 'Book A',
          cover_url: null,
          status: 'to_read',
          visibility: 'private',
          tags: [],
          created_at: undefined,
        },
        {
          id: 'item-2',
          work_id: 'work-2',
          work_title: 'Book B',
          cover_url: null,
          status: 'reading',
          visibility: 'private',
          tags: [],
          created_at: '2026-02-08T00:00:00Z',
        },
      ],
      next_cursor: null,
    });

    const wrapper = mountPage();
    await flushPromises();

    (wrapper.vm as any).sortMode = 'oldest';
    await flushPromises();

    expect(wrapper.text()).toContain('Book A');
    expect(wrapper.text()).toContain('Book B');
  });

  it('does not render paginator when no items are present', async () => {
    apiRequest.mockResolvedValueOnce({ items: [], next_cursor: null });

    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.find('[data-test="library-paginator"]').exists()).toBe(false);
    expect(apiRequest).toHaveBeenCalledTimes(1);
  });

  it('resets to the last available page when current page exceeds total pages', async () => {
    apiRequest
      .mockResolvedValueOnce({ items: [], next_cursor: null })
      .mockResolvedValueOnce({
        items: [],
        pagination: {
          page: 2,
          page_size: 25,
          total_count: 1,
          total_pages: 1,
          from: 0,
          to: 0,
          has_prev: true,
          has_next: false,
        },
        next_cursor: null,
      })
      .mockResolvedValueOnce({
        items: [
          {
            id: 'item-1',
            work_id: 'work-1',
            work_title: 'Book A',
            author_names: ['Author A'],
            cover_url: null,
            status: 'to_read',
            visibility: 'private',
            tags: [],
            created_at: '2026-02-08T00:00:00Z',
          },
        ],
        pagination: {
          page: 1,
          page_size: 25,
          total_count: 1,
          total_pages: 1,
          from: 1,
          to: 1,
          has_prev: false,
          has_next: false,
        },
        next_cursor: null,
      });

    const wrapper = mountPage();
    await flushPromises();

    (wrapper.vm as any).page = 2;
    await (wrapper.vm as any).fetchPage();
    await flushPromises();

    expect((wrapper.vm as any).page).toBe(1);
    const listCalls = apiRequest.mock.calls.filter((c) => c[0] === '/api/v1/library/items');
    expect(listCalls).toHaveLength(3);
    expect(listCalls[2][1]).toEqual(
      expect.objectContaining({
        query: expect.objectContaining({ page: 1 }),
      }),
    );
  });

  it('patches status inline and updates the local item', async () => {
    apiRequest
      .mockResolvedValueOnce({
        items: [
          {
            id: 'item-1',
            work_id: 'work-1',
            work_title: 'Book A',
            author_names: ['Author A'],
            cover_url: null,
            status: 'to_read',
            visibility: 'private',
            tags: ['Favorites'],
            created_at: '2026-02-08T00:00:00Z',
          },
        ],
        next_cursor: null,
      })
      .mockResolvedValueOnce({
        id: 'item-1',
        work_id: 'work-1',
        work_title: 'Book A',
        status: 'completed',
        visibility: 'private',
        tags: ['Favorites'],
      });

    const wrapper = mountPage();
    await flushPromises();

    await wrapper.get('[data-test="library-item-status-chip"]').trigger('click');
    await flushPromises();
    await wrapper.get('[data-test="library-item-status-edit"]').trigger('click');
    await flushPromises();

    expect(apiRequest).toHaveBeenNthCalledWith(2, '/api/v1/library/items/item-1', {
      method: 'PATCH',
      body: { status: 'completed' },
    });
    expect((wrapper.vm as any).items[0].status).toBe('completed');
    expect(wrapper.find('[data-test="library-read-date-dialog"]').exists()).toBe(true);
    expect(toastAdd).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'success', summary: 'Status updated.' }),
    );
  });

  it('saves a completion date from the status prompt', async () => {
    apiRequest
      .mockResolvedValueOnce({
        items: [
          {
            id: 'item-1',
            work_id: 'work-1',
            work_title: 'Book A',
            author_names: ['Author A'],
            cover_url: null,
            status: 'to_read',
            visibility: 'private',
            tags: ['Favorites'],
            created_at: '2026-02-08T00:00:00Z',
          },
        ],
        next_cursor: null,
      })
      .mockResolvedValueOnce({
        id: 'item-1',
        work_id: 'work-1',
        work_title: 'Book A',
        status: 'completed',
        visibility: 'private',
        tags: ['Favorites'],
      })
      .mockResolvedValueOnce({ id: 'session-1' });

    const wrapper = mountPage();
    await flushPromises();

    await wrapper.get('[data-test="library-item-status-chip"]').trigger('click');
    await flushPromises();
    await wrapper.get('[data-test="library-item-status-edit"]').trigger('click');
    await flushPromises();
    await wrapper.get('[data-test="library-read-date-today"]').trigger('click');
    await flushPromises();

    expect(apiRequest).toHaveBeenNthCalledWith(
      3,
      '/api/v1/library/items/item-1/sessions',
      expect.objectContaining({
        method: 'POST',
        body: expect.objectContaining({
          started_at: expect.any(String),
          ended_at: expect.any(String),
        }),
      }),
    );
    expect(toastAdd).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'success', summary: 'Saved 1 completed read.' }),
    );
  });

  it('allows skipping read date prompt without creating a session', async () => {
    apiRequest
      .mockResolvedValueOnce({
        items: [
          {
            id: 'item-1',
            work_id: 'work-1',
            work_title: 'Book A',
            author_names: ['Author A'],
            cover_url: null,
            status: 'to_read',
            visibility: 'private',
            tags: ['Favorites'],
            created_at: '2026-02-08T00:00:00Z',
          },
        ],
        next_cursor: null,
      })
      .mockResolvedValueOnce({
        id: 'item-1',
        work_id: 'work-1',
        work_title: 'Book A',
        status: 'completed',
        visibility: 'private',
        tags: ['Favorites'],
      });

    const wrapper = mountPage();
    await flushPromises();

    await wrapper.get('[data-test="library-item-status-chip"]').trigger('click');
    await flushPromises();
    await wrapper.get('[data-test="library-item-status-edit"]').trigger('click');
    await flushPromises();
    await wrapper.get('[data-test="library-read-date-skip"]').trigger('click');
    await flushPromises();

    expect(apiRequest).toHaveBeenCalledTimes(2);
    expect(wrapper.find('[data-test="library-read-date-dialog"]').exists()).toBe(false);
  });

  it('supports reading start-date prompt with reading-specific labels and payload', async () => {
    apiRequest
      .mockResolvedValueOnce({
        items: [
          {
            id: 'item-1',
            work_id: 'work-1',
            work_title: 'Book A',
            author_names: ['Author A'],
            cover_url: null,
            status: 'to_read',
            visibility: 'private',
            tags: ['Favorites'],
            created_at: '2026-02-08T00:00:00Z',
          },
        ],
        next_cursor: null,
      })
      .mockResolvedValueOnce({ id: 'session-1' });

    const wrapper = mountPage();
    await flushPromises();

    const item = (wrapper.vm as any).items[0];
    (wrapper.vm as any).openReadDatePrompt(item, 'reading');
    await flushPromises();

    expect((wrapper.vm as any).readDateDialogHeader).toBe('Add reading start date');
    expect((wrapper.vm as any).readDateDialogBody).toContain('current read');
    expect((wrapper.vm as any).readDateTodayButtonLabel).toBe('Start today and save');
    expect((wrapper.vm as any).readDateSaveButtonLabel).toBe('Save read history');
    (wrapper.vm as any).readingCurrentStartDate = new Date('2026-02-10T12:00:00.000Z');
    await (wrapper.vm as any).saveReadDatePrompt();
    await flushPromises();

    expect(apiRequest).toHaveBeenNthCalledWith(
      2,
      '/api/v1/library/items/item-1/sessions',
      expect.objectContaining({
        method: 'POST',
        body: expect.objectContaining({ started_at: expect.any(String) }),
      }),
    );
    expect(apiRequest.mock.calls[1]?.[1]?.body?.ended_at).toBeUndefined();
    expect(toastAdd).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'success', summary: 'Reading dates saved.' }),
    );
  });

  it('saves multiple completed read ranges', async () => {
    apiRequest
      .mockResolvedValueOnce({
        items: [
          {
            id: 'item-1',
            work_id: 'work-1',
            work_title: 'Book A',
            author_names: ['Author A'],
            cover_url: null,
            status: 'to_read',
            visibility: 'private',
            tags: ['Favorites'],
            created_at: '2026-02-08T00:00:00Z',
          },
        ],
        next_cursor: null,
      })
      .mockResolvedValueOnce({ id: 'session-1' })
      .mockResolvedValueOnce({ id: 'session-2' });

    const wrapper = mountPage();
    await flushPromises();

    const item = (wrapper.vm as any).items[0];
    (wrapper.vm as any).openReadDatePrompt(item, 'completed');
    (wrapper.vm as any).addCompletedReadEntry();
    (wrapper.vm as any).completedReadEntries[0].startedAt = new Date('2026-01-01T00:00:00.000Z');
    (wrapper.vm as any).completedReadEntries[0].endedAt = new Date('2026-01-10T00:00:00.000Z');
    (wrapper.vm as any).completedReadEntries[1].startedAt = new Date('2026-02-01T00:00:00.000Z');
    (wrapper.vm as any).completedReadEntries[1].endedAt = new Date('2026-02-05T00:00:00.000Z');
    await flushPromises();

    await (wrapper.vm as any).saveReadDatePrompt();
    await flushPromises();

    const sessionCalls = apiRequest.mock.calls.filter((c) =>
      String(c[0]).includes('/api/v1/library/items/item-1/sessions'),
    );
    expect(sessionCalls).toHaveLength(2);
    expect(toastAdd).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'success', summary: 'Saved 2 completed reads.' }),
    );
  });

  it('saves reading start date with optional previous completed reads', async () => {
    apiRequest
      .mockResolvedValueOnce({
        items: [
          {
            id: 'item-1',
            work_id: 'work-1',
            work_title: 'Book A',
            author_names: ['Author A'],
            cover_url: null,
            status: 'to_read',
            visibility: 'private',
            tags: ['Favorites'],
            created_at: '2026-02-08T00:00:00Z',
          },
        ],
        next_cursor: null,
      })
      .mockResolvedValueOnce({ id: 'session-1' })
      .mockResolvedValueOnce({ id: 'session-2' });

    const wrapper = mountPage();
    await flushPromises();

    const item = (wrapper.vm as any).items[0];
    (wrapper.vm as any).openReadDatePrompt(item, 'reading');
    (wrapper.vm as any).readingCurrentStartDate = new Date('2026-02-15T00:00:00.000Z');
    (wrapper.vm as any).addPreviousReadEntry();
    (wrapper.vm as any).previousReadEntries[0].startedAt = new Date('2026-01-01T00:00:00.000Z');
    (wrapper.vm as any).previousReadEntries[0].endedAt = new Date('2026-01-12T00:00:00.000Z');
    await flushPromises();

    await (wrapper.vm as any).saveReadDatePrompt();
    await flushPromises();

    const sessionCalls = apiRequest.mock.calls.filter((c) =>
      String(c[0]).includes('/api/v1/library/items/item-1/sessions'),
    );
    expect(sessionCalls).toHaveLength(2);
    expect(sessionCalls[0]?.[1]?.body?.ended_at).toBeUndefined();
    expect(sessionCalls[1]?.[1]?.body?.ended_at).toEqual(expect.any(String));
    expect(toastAdd).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'success', summary: 'Reading dates saved.' }),
    );
  });

  it('refetches and closes prompt when saving a read date returns 404', async () => {
    apiRequest
      .mockResolvedValueOnce({
        items: [
          {
            id: 'item-1',
            work_id: 'work-1',
            work_title: 'Book A',
            author_names: ['Author A'],
            cover_url: null,
            status: 'to_read',
            visibility: 'private',
            tags: ['Favorites'],
            created_at: '2026-02-08T00:00:00Z',
          },
        ],
        next_cursor: null,
      })
      .mockRejectedValueOnce(new ApiClientErrorMock('Not found', 'not_found', 404))
      .mockResolvedValueOnce({ items: [], next_cursor: null });

    const wrapper = mountPage();
    await flushPromises();

    const item = (wrapper.vm as any).items[0];
    (wrapper.vm as any).openReadDatePrompt(item, 'completed');
    await flushPromises();

    await (wrapper.vm as any).saveReadDatePrompt();
    await flushPromises();

    expect(toastAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'info',
        summary: 'This item was already removed. Refreshing...',
      }),
    );
    expect((wrapper.vm as any).readDateDialogOpen).toBe(false);
    const listCalls = apiRequest.mock.calls.filter((c) => c[0] === '/api/v1/library/items');
    expect(listCalls.length).toBe(2);
  });

  it('shows a save-date error and keeps prompt open on non-404 failures', async () => {
    apiRequest
      .mockResolvedValueOnce({
        items: [
          {
            id: 'item-1',
            work_id: 'work-1',
            work_title: 'Book A',
            author_names: ['Author A'],
            cover_url: null,
            status: 'to_read',
            visibility: 'private',
            tags: ['Favorites'],
            created_at: '2026-02-08T00:00:00Z',
          },
        ],
        next_cursor: null,
      })
      .mockRejectedValueOnce(new ApiClientErrorMock('Cannot save date', 'bad_request', 400));

    const wrapper = mountPage();
    await flushPromises();

    const item = (wrapper.vm as any).items[0];
    (wrapper.vm as any).openReadDatePrompt(item, 'completed');
    (wrapper.vm as any).readDateSaving = true;
    (wrapper.vm as any).closeReadDatePrompt();
    expect((wrapper.vm as any).readDateDialogOpen).toBe(true);
    (wrapper.vm as any).readDateSaving = false;
    await flushPromises();

    await (wrapper.vm as any).saveReadDatePrompt();
    await flushPromises();

    expect(toastAdd).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'error', summary: 'Cannot save date' }),
    );
    expect((wrapper.vm as any).readDateDialogOpen).toBe(true);
  });

  it('validates malformed completed and previous read date ranges', async () => {
    apiRequest.mockResolvedValueOnce({
      items: [
        {
          id: 'item-1',
          work_id: 'work-1',
          work_title: 'Book A',
          author_names: ['Author A'],
          cover_url: null,
          status: 'to_read',
          visibility: 'private',
          tags: [],
          created_at: '2026-02-08T00:00:00Z',
        },
      ],
      next_cursor: null,
    });

    const wrapper = mountPage();
    await flushPromises();

    const item = (wrapper.vm as any).items[0];

    (wrapper.vm as any).openReadDatePrompt(item, 'completed');
    (wrapper.vm as any).completedReadEntries[0].startedAt = null;
    (wrapper.vm as any).completedReadEntries[0].endedAt = new Date('2026-02-01T00:00:00.000Z');
    await (wrapper.vm as any).saveReadDatePrompt();
    expect((wrapper.vm as any).readDateFormError).toContain('completed read needs both');

    (wrapper.vm as any).openReadDatePrompt(item, 'completed');
    (wrapper.vm as any).completedReadEntries[0].startedAt = new Date('2026-02-10T00:00:00.000Z');
    (wrapper.vm as any).completedReadEntries[0].endedAt = new Date('2026-02-01T00:00:00.000Z');
    await (wrapper.vm as any).saveReadDatePrompt();
    expect((wrapper.vm as any).readDateFormError).toContain('same as or after');

    (wrapper.vm as any).openReadDatePrompt(item, 'reading');
    (wrapper.vm as any).completedReadEntries = [];
    (wrapper.vm as any).openReadDatePrompt(item, 'completed');
    (wrapper.vm as any).completedReadEntries = [];
    await (wrapper.vm as any).saveReadDatePrompt();
    expect((wrapper.vm as any).readDateFormError).toContain('at least one completed read');

    (wrapper.vm as any).openReadDatePrompt(item, 'reading');
    (wrapper.vm as any).addPreviousReadEntry();
    (wrapper.vm as any).readingCurrentStartDate = new Date('2026-02-10T00:00:00.000Z');
    (wrapper.vm as any).previousReadEntries[0].startedAt = new Date('2026-01-01T00:00:00.000Z');
    (wrapper.vm as any).previousReadEntries[0].endedAt = null;
    await (wrapper.vm as any).saveReadDatePrompt();
    expect((wrapper.vm as any).readDateFormError).toContain('previous read needs both');

    (wrapper.vm as any).openReadDatePrompt(item, 'reading');
    (wrapper.vm as any).addPreviousReadEntry();
    (wrapper.vm as any).readingCurrentStartDate = new Date('2026-02-10T00:00:00.000Z');
    (wrapper.vm as any).previousReadEntries[0].startedAt = new Date('2026-01-15T00:00:00.000Z');
    (wrapper.vm as any).previousReadEntries[0].endedAt = new Date('2026-01-01T00:00:00.000Z');
    await (wrapper.vm as any).saveReadDatePrompt();
    expect((wrapper.vm as any).readDateFormError).toContain('same as or after');
  });

  it('supports quick-today fallback and entry removal helpers', async () => {
    apiRequest
      .mockResolvedValueOnce({
        items: [
          {
            id: 'item-1',
            work_id: 'work-1',
            work_title: 'Book A',
            author_names: ['Author A'],
            cover_url: null,
            status: 'to_read',
            visibility: 'private',
            tags: [],
            created_at: '2026-02-08T00:00:00Z',
          },
        ],
        next_cursor: null,
      })
      .mockResolvedValueOnce({ id: 'session-1' });

    const wrapper = mountPage();
    await flushPromises();

    const item = (wrapper.vm as any).items[0];
    (wrapper.vm as any).openReadDatePrompt(item, 'completed');
    (wrapper.vm as any).completedReadEntries = [];
    await (wrapper.vm as any).saveReadDatePrompt(true);
    await flushPromises();

    expect(apiRequest).toHaveBeenNthCalledWith(
      2,
      '/api/v1/library/items/item-1/sessions',
      expect.objectContaining({ method: 'POST' }),
    );

    (wrapper.vm as any).openReadDatePrompt(item, 'reading');
    (wrapper.vm as any).saveReadDatePrompt(true);
    await flushPromises();

    expect(apiRequest).toHaveBeenNthCalledWith(
      3,
      '/api/v1/library/items/item-1/sessions',
      expect.objectContaining({ method: 'POST' }),
    );

    (wrapper.vm as any).openReadDatePrompt(item, 'reading');
    (wrapper.vm as any).addPreviousReadEntry();
    const key = (wrapper.vm as any).previousReadEntries[0].key;
    (wrapper.vm as any).removePreviousReadEntry(key);
    expect((wrapper.vm as any).previousReadEntries).toHaveLength(0);

    (wrapper.vm as any).openReadDatePrompt(item, 'completed');
    (wrapper.vm as any).addCompletedReadEntry();
    const removeKey = (wrapper.vm as any).completedReadEntries[1].key;
    (wrapper.vm as any).removeCompletedReadEntry(removeKey);
    expect((wrapper.vm as any).completedReadEntries).toHaveLength(1);

    (wrapper.vm as any).openReadDatePrompt(item, 'completed');
    const onlyKey = (wrapper.vm as any).completedReadEntries[0].key;
    (wrapper.vm as any).removeCompletedReadEntry(onlyKey);
    expect((wrapper.vm as any).completedReadEntries).toHaveLength(1);
  });

  it('covers remaining read-date helper guards and computed labels', async () => {
    apiRequest.mockResolvedValueOnce({
      items: [
        {
          id: 'item-1',
          work_id: 'work-1',
          work_title: 'Book A',
          author_names: ['Author A'],
          cover_url: null,
          status: 'to_read',
          visibility: 'private',
          tags: [],
          created_at: '2026-02-08T00:00:00Z',
        },
      ],
      next_cursor: null,
    });

    const wrapper = mountPage();
    await flushPromises();

    const item = (wrapper.vm as any).items[0];
    (wrapper.vm as any).openReadDatePrompt(item, 'completed');
    expect((wrapper.vm as any).readDateDialogBody).toContain('one or more completed reads');

    (wrapper.vm as any).openReadDatePrompt(item, 'reading');
    (wrapper.vm as any).readingCurrentStartDate = null;
    await (wrapper.vm as any).saveReadDatePrompt();
    expect((wrapper.vm as any).readDateFormError).toContain('start date for your current read');
  });

  it('renders read-date dialog controls and triggers dialog button handlers', async () => {
    apiRequest
      .mockResolvedValueOnce({
        items: [
          {
            id: 'item-1',
            work_id: 'work-1',
            work_title: 'Book A',
            author_names: ['Author A'],
            cover_url: null,
            status: 'to_read',
            visibility: 'private',
            tags: [],
            created_at: '2026-02-08T00:00:00Z',
          },
        ],
        next_cursor: null,
      })
      .mockResolvedValue({ id: 'session-1' });

    const wrapper = mountPage();
    await flushPromises();

    const item = (wrapper.vm as any).items[0];

    (wrapper.vm as any).openReadDatePrompt(item, 'completed');
    await flushPromises();
    await wrapper.get('[data-test="library-read-date-add-completed"]').trigger('click');
    await flushPromises();

    (wrapper.vm as any).completedReadEntries[0].startedAt = new Date('2026-02-01T00:00:00.000Z');
    (wrapper.vm as any).completedReadEntries[0].endedAt = new Date('2026-02-02T00:00:00.000Z');
    (wrapper.vm as any).completedReadEntries[1].startedAt = new Date('2026-02-03T00:00:00.000Z');
    (wrapper.vm as any).completedReadEntries[1].endedAt = new Date('2026-02-04T00:00:00.000Z');
    await flushPromises();

    await wrapper.get('button[aria-label="Remove completed read 2"]').trigger('click');
    await flushPromises();
    await wrapper.get('[data-test="library-read-date-save"]').trigger('click');
    await flushPromises();

    (wrapper.vm as any).openReadDatePrompt(item, 'reading');
    await flushPromises();
    expect(wrapper.find('[data-test="library-read-current-start"]').exists()).toBe(true);
    await wrapper.get('[data-test="library-read-date-add-previous"]').trigger('click');
    await flushPromises();
    (wrapper.vm as any).readingCurrentStartDate = new Date('2026-02-10T00:00:00.000Z');
    (wrapper.vm as any).previousReadEntries[0].startedAt = new Date('2026-01-01T00:00:00.000Z');
    (wrapper.vm as any).previousReadEntries[0].endedAt = new Date('2026-01-02T00:00:00.000Z');
    await flushPromises();
    await wrapper.get('button[aria-label="Remove previous read 1"]').trigger('click');
    await flushPromises();
  });

  it('maps range DatePicker updates for completed and previous reads', async () => {
    apiRequest.mockResolvedValueOnce({
      items: [
        {
          id: 'item-1',
          work_id: 'work-1',
          work_title: 'Book A',
          author_names: ['Author A'],
          cover_url: null,
          status: 'to_read',
          visibility: 'private',
          tags: [],
          created_at: '2026-02-08T00:00:00Z',
        },
      ],
      next_cursor: null,
    });

    const wrapper = mountPage();
    await flushPromises();
    const item = (wrapper.vm as any).items[0];

    (wrapper.vm as any).openReadDatePrompt(item, 'completed');
    await flushPromises();
    await wrapper.get('[data-test="library-read-completed-range-0"]').trigger('click');
    await flushPromises();
    expect((wrapper.vm as any).completedReadEntries[0].startedAt).toBeNull();
    expect((wrapper.vm as any).completedReadEntries[0].endedAt).toBeNull();

    const completedStart = new Date('2025-08-11T00:00:00.000Z');
    const completedEnd = new Date('2025-08-20T00:00:00.000Z');
    wrapper
      .getComponent('[data-test="library-read-completed-range-0"]')
      .vm.$emit('update:modelValue', [completedStart, completedEnd]);
    await flushPromises();
    expect((wrapper.vm as any).completedReadEntries[0].startedAt).toEqual(completedStart);
    expect((wrapper.vm as any).completedReadEntries[0].endedAt).toEqual(completedEnd);

    (wrapper.vm as any).openReadDatePrompt(item, 'reading');
    await flushPromises();
    await wrapper.get('[data-test="library-read-date-add-previous"]').trigger('click');
    await flushPromises();
    await wrapper.get('[data-test="library-read-previous-range-0"]').trigger('click');
    await flushPromises();
    expect((wrapper.vm as any).previousReadEntries[0].startedAt).toBeNull();
    expect((wrapper.vm as any).previousReadEntries[0].endedAt).toBeNull();

    const previousStart = new Date('2025-08-01T00:00:00.000Z');
    const previousEnd = new Date('2025-08-08T00:00:00.000Z');
    wrapper
      .getComponent('[data-test="library-read-previous-range-0"]')
      .vm.$emit('update:modelValue', [previousStart, previousEnd]);
    await flushPromises();
    expect((wrapper.vm as any).previousReadEntries[0].startedAt).toEqual(previousStart);
    expect((wrapper.vm as any).previousReadEntries[0].endedAt).toEqual(previousEnd);
  });

  it('renders abandoned status pills across view modes', async () => {
    apiRequest.mockResolvedValueOnce({
      items: [
        {
          id: 'item-1',
          work_id: 'work-1',
          work_title: 'Abandoned Book',
          author_names: ['Author A'],
          cover_url: null,
          status: 'abandoned',
          visibility: 'private',
          tags: [],
          created_at: '2026-02-08T00:00:00Z',
        },
      ],
      next_cursor: null,
    });

    const wrapper = mountPage();
    await flushPromises();
    expect(wrapper.text()).toContain('Abandoned');

    (wrapper.vm as any).viewMode = 'table';
    await flushPromises();
    expect(wrapper.text()).toContain('Abandoned');

    (wrapper.vm as any).viewMode = 'grid';
    await flushPromises();
    expect(wrapper.text()).toContain('Abandoned');
  });

  it('patches visibility inline and reverts when update fails', async () => {
    apiRequest
      .mockResolvedValueOnce({
        items: [
          {
            id: 'item-1',
            work_id: 'work-1',
            work_title: 'Book A',
            author_names: ['Author A'],
            cover_url: null,
            status: 'to_read',
            visibility: 'private',
            tags: ['Favorites'],
            created_at: '2026-02-08T00:00:00Z',
          },
        ],
        next_cursor: null,
      })
      .mockRejectedValueOnce(new Error('boom'));

    const wrapper = mountPage();
    await flushPromises();

    await wrapper.get('[data-test="library-item-visibility-chip"]').trigger('click');
    await flushPromises();
    await wrapper.get('[data-test="library-item-visibility-edit"]').trigger('click');
    await flushPromises();

    expect(apiRequest).toHaveBeenNthCalledWith(2, '/api/v1/library/items/item-1', {
      method: 'PATCH',
      body: { visibility: 'public' },
    });
    expect((wrapper.vm as any).items[0].visibility).toBe('private');
    expect(toastAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'error',
        summary: 'Unable to update this item right now.',
      }),
    );
  });

  it('refetches when inline update returns 404', async () => {
    apiRequest
      .mockResolvedValueOnce({
        items: [
          {
            id: 'item-1',
            work_id: 'work-1',
            work_title: 'Book A',
            author_names: ['Author A'],
            cover_url: null,
            status: 'to_read',
            visibility: 'private',
            tags: ['Favorites'],
            created_at: '2026-02-08T00:00:00Z',
          },
        ],
        next_cursor: null,
      })
      .mockRejectedValueOnce(new ApiClientErrorMock('Not found', 'not_found', 404))
      .mockResolvedValueOnce({ items: [], next_cursor: null });

    const wrapper = mountPage();
    await flushPromises();

    await wrapper.get('[data-test="library-item-status-chip"]').trigger('click');
    await flushPromises();
    await wrapper.get('[data-test="library-item-status-edit"]').trigger('click');
    await flushPromises();

    const listCalls = apiRequest.mock.calls.filter((c) => c[0] === '/api/v1/library/items');
    expect(listCalls.length).toBe(2);
    expect(toastAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'info',
        summary: 'This item was already removed. Refreshing...',
      }),
    );
  });

  it('shows ApiClientError message for inline update failures', async () => {
    apiRequest
      .mockResolvedValueOnce({
        items: [
          {
            id: 'item-1',
            work_id: 'work-1',
            work_title: 'Book A',
            author_names: ['Author A'],
            cover_url: null,
            status: 'to_read',
            visibility: 'private',
            tags: ['Favorites'],
            created_at: '2026-02-08T00:00:00Z',
          },
        ],
        next_cursor: null,
      })
      .mockRejectedValueOnce(new ApiClientErrorMock('Invalid transition', 'invalid_status', 400));

    const wrapper = mountPage();
    await flushPromises();

    await wrapper.get('[data-test="library-item-status-chip"]').trigger('click');
    await flushPromises();
    await wrapper.get('[data-test="library-item-status-edit"]').trigger('click');
    await flushPromises();

    expect(toastAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'error',
        summary: 'Invalid transition',
      }),
    );
  });

  it('ignores invalid inline edit payloads and in-flight updates', async () => {
    apiRequest.mockResolvedValueOnce({
      items: [
        {
          id: 'item-1',
          work_id: 'work-1',
          work_title: 'Book A',
          author_names: ['Author A'],
          cover_url: null,
          status: 'to_read',
          visibility: 'private',
          tags: ['Favorites'],
          created_at: '2026-02-08T00:00:00Z',
        },
      ],
      next_cursor: null,
    });

    const wrapper = mountPage();
    await flushPromises();

    const item = (wrapper.vm as any).items[0];
    (wrapper.vm as any).onStatusEdit(item, 123);
    (wrapper.vm as any).onStatusEdit(item, 'invalid-status');
    (wrapper.vm as any).onVisibilityEdit(item, 'friends-only');
    (wrapper.vm as any).itemFieldUpdates['item-1:status'] = true;
    (wrapper.vm as any).onStatusEdit(item, 'completed');
    await flushPromises();

    expect(apiRequest).toHaveBeenCalledTimes(1);
  });

  it('does not close inline editor when edit payload is invalid', async () => {
    apiRequest.mockResolvedValueOnce({
      items: [
        {
          id: 'item-1',
          work_id: 'work-1',
          work_title: 'Book A',
          author_names: ['Author A'],
          cover_url: null,
          status: 'to_read',
          visibility: 'private',
          tags: [],
          created_at: '2026-02-08T00:00:00Z',
        },
      ],
      next_cursor: null,
    });

    const wrapper = mountPage();
    await flushPromises();

    const item = (wrapper.vm as any).items[0];
    const closeStatus = vi.fn();
    const closeVisibility = vi.fn();
    await (wrapper.vm as any).onStatusEditAndClose(item, 123, closeStatus);
    await (wrapper.vm as any).onVisibilityEditAndClose(item, 'friends-only', closeVisibility);
    await flushPromises();

    expect(closeStatus).not.toHaveBeenCalled();
    expect(closeVisibility).not.toHaveBeenCalled();
    expect(apiRequest).toHaveBeenCalledTimes(1);
  });

  it('updates via table mode inline controls', async () => {
    apiRequest
      .mockResolvedValueOnce({
        items: [
          {
            id: 'item-1',
            work_id: 'work-1',
            work_title: 'Book A',
            author_names: ['Author A'],
            cover_url: null,
            status: 'to_read',
            visibility: 'private',
            tags: ['Favorites'],
            created_at: '2026-02-08T00:00:00Z',
          },
        ],
        next_cursor: null,
      })
      .mockResolvedValueOnce({
        id: 'item-1',
        work_id: 'work-1',
        work_title: 'Book A',
        status: 'completed',
        visibility: 'private',
        tags: ['Favorites'],
      })
      .mockResolvedValueOnce({
        id: 'item-1',
        work_id: 'work-1',
        work_title: 'Book A',
        status: 'completed',
        visibility: 'public',
        tags: ['Favorites'],
      });

    const wrapper = mountPage();
    await flushPromises();
    (wrapper.vm as any).viewMode = 'table';
    await flushPromises();

    await wrapper.findAll('[data-test="library-item-status-chip"]').at(0)!.trigger('click');
    await flushPromises();
    await wrapper.findAll('[data-test="library-item-status-edit"]').at(0)!.trigger('click');
    await flushPromises();
    await wrapper.findAll('[data-test="library-item-visibility-chip"]').at(0)!.trigger('click');
    await flushPromises();
    await wrapper.findAll('[data-test="library-item-visibility-edit"]').at(0)!.trigger('click');
    await flushPromises();

    expect(apiRequest).toHaveBeenNthCalledWith(2, '/api/v1/library/items/item-1', {
      method: 'PATCH',
      body: { status: 'completed' },
    });
    expect(apiRequest).toHaveBeenNthCalledWith(3, '/api/v1/library/items/item-1', {
      method: 'PATCH',
      body: { visibility: 'public' },
    });
  });

  it('updates via grid mode inline controls', async () => {
    apiRequest
      .mockResolvedValueOnce({
        items: [
          {
            id: 'item-1',
            work_id: 'work-1',
            work_title: 'Book A',
            author_names: ['Author A'],
            cover_url: null,
            status: 'to_read',
            visibility: 'private',
            tags: ['Favorites'],
            created_at: '2026-02-08T00:00:00Z',
          },
        ],
        next_cursor: null,
      })
      .mockResolvedValueOnce({
        id: 'item-1',
        work_id: 'work-1',
        work_title: 'Book A',
        status: 'completed',
        visibility: 'private',
        tags: ['Favorites'],
      })
      .mockResolvedValueOnce({
        id: 'item-1',
        work_id: 'work-1',
        work_title: 'Book A',
        status: 'completed',
        visibility: 'public',
        tags: ['Favorites'],
      });

    const wrapper = mountPage();
    await flushPromises();
    (wrapper.vm as any).viewMode = 'grid';
    await flushPromises();

    await wrapper.findAll('[data-test="library-item-status-chip"]').at(0)!.trigger('click');
    await flushPromises();
    await wrapper.findAll('[data-test="library-item-status-edit"]').at(0)!.trigger('click');
    await flushPromises();
    await wrapper.findAll('[data-test="library-item-visibility-chip"]').at(0)!.trigger('click');
    await flushPromises();
    await wrapper.findAll('[data-test="library-item-visibility-edit"]').at(0)!.trigger('click');
    await flushPromises();

    expect(apiRequest).toHaveBeenNthCalledWith(2, '/api/v1/library/items/item-1', {
      method: 'PATCH',
      body: { status: 'completed' },
    });
    expect(apiRequest).toHaveBeenNthCalledWith(3, '/api/v1/library/items/item-1', {
      method: 'PATCH',
      body: { visibility: 'public' },
    });
  });

  it('opens remove confirm and deletes an item on confirm', async () => {
    apiRequest
      .mockResolvedValueOnce({
        items: [
          {
            id: 'item-1',
            work_id: 'work-1',
            work_title: 'Book A',
            author_names: ['Author A'],
            cover_url: 'https://example.com/cover.jpg',
            status: 'to_read',
            visibility: 'private',
            tags: ['Favorites'],
            created_at: '2026-02-08T00:00:00Z',
          },
        ],
        next_cursor: null,
      })
      .mockResolvedValueOnce({ deleted: true });

    const wrapper = mountPage();
    await flushPromises();

    await wrapper.get('[data-test="library-item-remove"]').trigger('click');
    expect(wrapper.find('[data-test="library-remove-dialog"]').exists()).toBe(true);

    await wrapper.get('[data-test="library-remove-confirm"]').trigger('click');
    await flushPromises();

    expect(apiRequest).toHaveBeenCalledWith('/api/v1/library/items/item-1', { method: 'DELETE' });
    expect(wrapper.text()).not.toContain('Book A');
    expect(toastAdd).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'success', summary: 'Removed from your library.' }),
    );
  });

  it('decrements page before refetch when removing the last item on a non-first page', async () => {
    apiRequest
      .mockResolvedValueOnce({
        items: [
          {
            id: 'item-1',
            work_id: 'work-1',
            work_title: 'Book A',
            author_names: ['Author A'],
            cover_url: null,
            status: 'to_read',
            visibility: 'private',
            tags: [],
            created_at: '2026-02-08T00:00:00Z',
          },
        ],
        pagination: {
          page: 2,
          page_size: 25,
          total_count: 26,
          total_pages: 2,
          from: 26,
          to: 26,
          has_prev: true,
          has_next: false,
        },
        next_cursor: null,
      })
      .mockResolvedValueOnce({ deleted: true })
      .mockResolvedValueOnce({
        items: [],
        pagination: {
          page: 1,
          page_size: 25,
          total_count: 25,
          total_pages: 1,
          from: 1,
          to: 25,
          has_prev: false,
          has_next: false,
        },
        next_cursor: null,
      });

    const wrapper = mountPage();
    await flushPromises();

    (wrapper.vm as any).page = 2;
    await wrapper.get('[data-test="library-item-remove"]').trigger('click');
    await wrapper.get('[data-test="library-remove-confirm"]').trigger('click');
    await flushPromises();

    expect((wrapper.vm as any).page).toBe(1);
    const listCalls = apiRequest.mock.calls.filter((c) => c[0] === '/api/v1/library/items');
    expect(listCalls[1][1]).toEqual(
      expect.objectContaining({
        query: expect.objectContaining({ page: 1 }),
      }),
    );
  });

  it('does not refetch when paginator emits unchanged page and rows', async () => {
    apiRequest.mockResolvedValueOnce({ items: [], next_cursor: null });

    const wrapper = mountPage();
    await flushPromises();

    (wrapper.vm as any).onPageChange({ page: 0, rows: 25 });
    await flushPromises();

    const listCalls = apiRequest.mock.calls.filter((c) => c[0] === '/api/v1/library/items');
    expect(listCalls).toHaveLength(1);
  });

  it('handles 404 already-removed by toasting and refreshing', async () => {
    apiRequest
      .mockResolvedValueOnce({
        items: [
          {
            id: 'item-1',
            work_id: 'work-1',
            work_title: 'Book A',
            author_names: [],
            cover_url: null,
            status: 'to_read',
            visibility: 'private',
            tags: [],
            created_at: '2026-02-08T00:00:00Z',
          },
        ],
        next_cursor: null,
      })
      .mockRejectedValueOnce(new ApiClientErrorMock('Not found', 'not_found', 404))
      .mockResolvedValueOnce({ items: [], next_cursor: null });

    const wrapper = mountPage();
    await flushPromises();

    await wrapper.get('[data-test="library-item-remove"]').trigger('click');
    await wrapper.get('[data-test="library-remove-confirm"]').trigger('click');
    await flushPromises();

    expect(toastAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'info',
        summary: 'This item was already removed. Refreshing...',
      }),
    );
    const listCalls = apiRequest.mock.calls.filter((c) => c[0] === '/api/v1/library/items');
    expect(listCalls.length).toBe(2);
  });

  it('closes the remove dialog on cancel (and does not close while loading)', async () => {
    apiRequest.mockResolvedValueOnce({
      items: [
        {
          id: 'item-1',
          work_id: 'work-1',
          work_title: 'Book A',
          author_names: [],
          cover_url: null,
          status: 'to_read',
          visibility: 'private',
          tags: [],
          created_at: '2026-02-08T00:00:00Z',
        },
      ],
      next_cursor: null,
    });

    const wrapper = mountPage();
    await flushPromises();

    await wrapper.get('[data-test="library-item-remove"]').trigger('click');
    expect(wrapper.find('[data-test="library-remove-dialog"]').exists()).toBe(true);

    (wrapper.vm as any).removeConfirmLoading = true;
    await flushPromises();
    (wrapper.vm as any).cancelRemoveConfirm();
    await flushPromises();
    expect(wrapper.find('[data-test="library-remove-dialog"]').exists()).toBe(true);

    (wrapper.vm as any).removeConfirmLoading = false;
    await flushPromises();
    (wrapper.vm as any).cancelRemoveConfirm();
    await flushPromises();
    expect(wrapper.find('[data-test="library-remove-dialog"]').exists()).toBe(false);
  });

  it('shows an error toast and keeps the dialog open when delete fails', async () => {
    apiRequest
      .mockResolvedValueOnce({
        items: [
          {
            id: 'item-1',
            work_id: 'work-1',
            work_title: 'Book A',
            author_names: [],
            cover_url: null,
            status: 'to_read',
            visibility: 'private',
            tags: [],
            created_at: '2026-02-08T00:00:00Z',
          },
        ],
        next_cursor: null,
      })
      .mockRejectedValueOnce(new Error('boom'));

    const wrapper = mountPage();
    await flushPromises();

    await wrapper.get('[data-test="library-item-remove"]').trigger('click');
    await wrapper.get('[data-test="library-remove-confirm"]').trigger('click');
    await flushPromises();

    expect(apiRequest).toHaveBeenCalledWith('/api/v1/library/items/item-1', { method: 'DELETE' });
    expect(wrapper.find('[data-test="library-remove-dialog"]').exists()).toBe(true);
    expect(toastAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'error',
        summary: 'Unable to remove this item right now.',
      }),
    );
  });

  it('shows ApiClientError message for non-404 delete failures', async () => {
    apiRequest
      .mockResolvedValueOnce({
        items: [
          {
            id: 'item-1',
            work_id: 'work-1',
            work_title: 'Book A',
            author_names: [],
            cover_url: null,
            status: 'to_read',
            visibility: 'private',
            tags: [],
            created_at: '2026-02-08T00:00:00Z',
          },
        ],
        next_cursor: null,
      })
      .mockRejectedValueOnce(new ApiClientErrorMock('Permission denied', 'forbidden', 403));

    const wrapper = mountPage();
    await flushPromises();

    await wrapper.get('[data-test="library-item-remove"]').trigger('click');
    await wrapper.get('[data-test="library-remove-confirm"]').trigger('click');
    await flushPromises();

    expect(toastAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'error',
        summary: 'Permission denied',
      }),
    );
  });

  it('renders the remove dialog message when the pending item is null (covers nullish branches)', async () => {
    apiRequest.mockResolvedValueOnce({ items: [], next_cursor: null });

    const wrapper = mountPage();
    await flushPromises();

    (wrapper.vm as any).pendingRemoveItem = null;
    (wrapper.vm as any).removeConfirmOpen = true;
    await flushPromises();

    expect(wrapper.get('[data-test="library-remove-dialog"]').text()).toContain('Remove ""');
  });

  it('falls back to an empty title when pending item is missing work_title', async () => {
    apiRequest.mockResolvedValueOnce({ items: [], next_cursor: null });

    const wrapper = mountPage();
    await flushPromises();

    (wrapper.vm as any).pendingRemoveItem = { id: 'item-1', work_id: 'work-1' } as any;
    (wrapper.vm as any).removeConfirmOpen = true;
    await flushPromises();

    expect(wrapper.get('[data-test="library-remove-dialog"]').text()).toContain('Remove ""');
  });

  it('does nothing when confirming remove without a pending item', async () => {
    apiRequest.mockResolvedValueOnce({ items: [], next_cursor: null });

    const wrapper = mountPage();
    await flushPromises();

    (wrapper.vm as any).pendingRemoveItem = null;
    await flushPromises();
    await (wrapper.vm as any).confirmRemove();
    await flushPromises();

    const listCalls = apiRequest.mock.calls.filter((c) => c[0] === '/api/v1/library/items');
    expect(listCalls.length).toBe(1);
  });

  it('falls back to an empty title when pending item has a null work_title', async () => {
    apiRequest.mockResolvedValueOnce({ items: [], next_cursor: null });

    const wrapper = mountPage();
    await flushPromises();

    (wrapper.vm as any).pendingRemoveItem = { id: 'item-1', work_id: 'work-1', work_title: null };
    (wrapper.vm as any).removeConfirmOpen = true;
    await flushPromises();

    expect(wrapper.get('[data-test="library-remove-dialog"]').text()).toContain('Remove ""');
  });

  it('updates dialog visibility via v-model event', async () => {
    apiRequest.mockResolvedValueOnce({ items: [], next_cursor: null });

    const wrapper = mountPage();
    await flushPromises();

    (wrapper.vm as any).removeConfirmOpen = true;
    await flushPromises();

    const dialog = wrapper
      .findAllComponents({ name: 'Dialog' })
      .find((candidate) => candidate.props('header') === 'Remove from library');
    expect(dialog).toBeDefined();
    if (!dialog) return;
    dialog.vm.$emit('update:visible', false);
    await flushPromises();

    expect((wrapper.vm as any).removeConfirmOpen).toBe(false);
  });

  it('toggles added sort back to newest when currently oldest', async () => {
    apiRequest.mockResolvedValueOnce({ items: [], next_cursor: null });

    const wrapper = mountPage();
    await flushPromises();

    (wrapper.vm as any).sortMode = 'oldest';
    (wrapper.vm as any).toggleAddedSort();
    await flushPromises();

    expect((wrapper.vm as any).sortMode).toBe('newest');
  });

  it('clears an existing debounce timer when tag filter changes rapidly', async () => {
    vi.useFakeTimers();
    const clearSpy = vi.spyOn(window, 'clearTimeout');
    apiRequest
      .mockResolvedValueOnce({ items: [], next_cursor: null })
      .mockResolvedValueOnce({ items: [], next_cursor: null });

    const wrapper = mountPage();
    await flushPromises();

    await wrapper.get('[data-test="library-tag-filter"]').setValue('fi');
    await wrapper.get('[data-test="library-tag-filter"]').setValue('fic');
    await flushPromises();

    expect(clearSpy).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('clears a pending debounce timer on unmount', async () => {
    vi.useFakeTimers();
    const clearSpy = vi.spyOn(window, 'clearTimeout');
    apiRequest.mockResolvedValueOnce({ items: [], next_cursor: null });

    const wrapper = mountPage();
    await flushPromises();

    await wrapper.get('[data-test="library-tag-filter"]').setValue('memoir');
    wrapper.unmount();

    expect(clearSpy).toHaveBeenCalled();
    vi.useRealTimers();
  });
});
