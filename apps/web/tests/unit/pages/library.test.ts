import { flushPromises, mount } from '@vue/test-utils';
import PrimeVue from 'primevue/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  route: { fullPath: '/library' },
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

vi.mock('~/utils/api', () => ({
  apiRequest,
  ApiClientError: ApiClientErrorMock,
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
    state.route = { fullPath: '/library' };
  });

  it('loads library items on mount', async () => {
    apiRequest.mockResolvedValueOnce({
      items: [
        {
          id: 'item-1',
          work_id: 'work-1',
          work_title: 'Book A',
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
  });

  it('loads next page when load more is clicked', async () => {
    apiRequest
      .mockResolvedValueOnce({
        items: [
          {
            id: 'item-1',
            work_id: 'work-1',
            work_title: 'Book A',
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
    const loginLink = wrapper.get('[data-test="library-login-link"]');
    expect(loginLink.attributes('href')).toBe('/login?returnTo=%2Flibrary');
  });

  it('uses /library as returnTo when route has no fullPath', async () => {
    state.route = {} as any;
    apiRequest.mockRejectedValueOnce(
      new ApiClientErrorMock('Sign in required', 'auth_required', 401),
    );

    const wrapper = mountPage();
    await flushPromises();

    const loginLink = wrapper.get('[data-test="library-login-link"]');
    expect(loginLink.attributes('href')).toBe('/login?returnTo=%2Flibrary');
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

  it('filters by tag substring (case-insensitive)', async () => {
    apiRequest.mockResolvedValueOnce({
      items: [
        {
          id: 'item-1',
          work_id: 'work-1',
          work_title: 'Book A',
          status: 'to_read',
          visibility: 'private',
          tags: ['Favorites', '2026'],
          created_at: '2026-02-08T00:00:00Z',
        },
        {
          id: 'item-2',
          work_id: 'work-2',
          work_title: 'Book B',
          status: 'reading',
          visibility: 'private',
          tags: ['SciFi'],
          created_at: '2026-02-09T00:00:00Z',
        },
        {
          id: 'item-3',
          work_id: 'work-3',
          work_title: 'Book C',
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
          status: 'to_read',
          visibility: 'private',
          tags: [],
          created_at: '2026-02-08T00:00:00Z',
        },
        {
          id: 'item-2',
          work_id: 'work-2',
          work_title: 'Alpha Book',
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

    const titleLinks = wrapper.get('[data-test="library-items"]').findAll('a');
    const titles = titleLinks.map((a) => a.text()).filter((t) => t !== 'Add books');
    expect(titles[0]).toBe('Alpha Book');
    expect(titles[1]).toBe('Zoo Book');
  });

  it('sorts by oldest first when selected programmatically', async () => {
    apiRequest.mockResolvedValueOnce({
      items: [
        {
          id: 'item-1',
          work_id: 'work-1',
          work_title: 'Book A',
          status: 'to_read',
          visibility: 'private',
          tags: [],
          created_at: '2026-02-09T00:00:00Z',
        },
        {
          id: 'item-2',
          work_id: 'work-2',
          work_title: 'Book B',
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

    const titleLinks = wrapper.get('[data-test="library-items"]').findAll('a');
    const titles = titleLinks.map((a) => a.text()).filter((t) => t !== 'Add books');
    expect(titles[0]).toBe('Book B');
    expect(titles[1]).toBe('Book A');
  });

  it('sorts even when created_at is missing (covers created_at fallback branches)', async () => {
    apiRequest.mockResolvedValueOnce({
      items: [
        {
          id: 'item-1',
          work_id: 'work-1',
          work_title: 'Book A',
          status: 'to_read',
          visibility: 'private',
          tags: [],
          created_at: undefined,
        },
        {
          id: 'item-2',
          work_id: 'work-2',
          work_title: 'Book B',
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

    // Default is newest-first; the item with a timestamp should come first.
    const titleLinks = wrapper.get('[data-test="library-items"]').findAll('a');
    const titles = titleLinks.map((a) => a.text()).filter((t) => t !== 'Add books');
    expect(titles[0]).toBe('Book B');
  });

  it('handles newest-first sorting when all created_at values are missing', async () => {
    apiRequest.mockResolvedValueOnce({
      items: [
        {
          id: 'item-1',
          work_id: 'work-1',
          work_title: 'Book A',
          status: 'to_read',
          visibility: 'private',
          tags: [],
          created_at: undefined,
        },
        {
          id: 'item-2',
          work_id: 'work-2',
          work_title: 'Book B',
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
          status: 'to_read',
          visibility: 'private',
          tags: [],
          created_at: undefined,
        },
        {
          id: 'item-2',
          work_id: 'work-2',
          work_title: 'Book B',
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
});
