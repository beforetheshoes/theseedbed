import { flushPromises, mount } from '@vue/test-utils';
import PrimeVue from 'primevue/config';
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

const mountPage = () =>
  mount(LibraryPage, {
    global: {
      plugins: [[PrimeVue, { ripple: false }]],
      stubs: {
        NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
        Dialog: {
          name: 'Dialog',
          props: ['visible', 'header'],
          emits: ['update:visible'],
          template: '<div v-if="visible" v-bind="$attrs"><slot /></div>',
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
                $attrs['data-test'] === 'library-sort-select' ? 'title_asc' : 'reading',
              )
            "
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
      },
    },
  });

describe('library page', () => {
  beforeEach(() => {
    apiRequest.mockReset();
    toastAdd.mockReset();
    state.route = { fullPath: '/library' };
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
      query: { limit: 10, cursor: undefined, status: undefined },
    });
    expect(wrapper.text()).toContain('Book A');
    expect(wrapper.findAll('[data-test="library-item-cover"]').length).toBe(1);
  });

  it('loads next page when load more is clicked', async () => {
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
        next_cursor: 'cursor-1',
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
        next_cursor: null,
      });

    const wrapper = mountPage();
    await flushPromises();
    await wrapper.get('[data-test="library-load-more"]').trigger('click');
    await flushPromises();

    expect(apiRequest).toHaveBeenNthCalledWith(2, '/api/v1/library/items', {
      query: { limit: 10, cursor: 'cursor-1', status: undefined },
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
      query: { limit: 10, cursor: undefined, status: 'reading' },
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
      query: { limit: 10, cursor: undefined, status: undefined },
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

  it('does not request another page when no cursor is present', async () => {
    apiRequest.mockResolvedValueOnce({ items: [], next_cursor: null });

    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.find('[data-test="library-load-more"]').exists()).toBe(false);
    expect(apiRequest).toHaveBeenCalledTimes(1);
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
});
