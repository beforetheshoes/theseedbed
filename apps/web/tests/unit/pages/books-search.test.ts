import { mount } from '@vue/test-utils';
import PrimeVue from 'primevue/config';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  route: { fullPath: '/books/search' },
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

vi.mock('~/utils/api', () => ({
  apiRequest,
  ApiClientError: ApiClientErrorMock,
}));

vi.mock('#imports', () => ({
  useRoute: () => state.route,
}));

vi.mock('primevue/usetoast', () => ({
  useToast: () => ({ add: toastAdd }),
}));

import SearchPage from '../../../app/pages/books/search.vue';

const searchResponse = (
  items: Array<{
    work_key: string;
    source?: string;
    source_id?: string;
    title: string;
    author_names: string[];
    first_publish_year: number | null;
    cover_url: string | null;
    edition_count?: number | null;
    languages?: unknown[];
    readable?: boolean;
    attribution?: { text?: unknown; url?: unknown } | null;
  }>,
  nextPage: number | null = null,
) => ({
  items,
  next_page: nextPage,
});

const deferred = <T>() => {
  const { promise, resolve, reject } = Promise.withResolvers<T>();
  return { promise, resolve, reject };
};

const mountPage = () =>
  mount(SearchPage, {
    global: {
      plugins: [[PrimeVue, { ripple: false }]],
      stubs: {
        NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
        Select: {
          props: ['modelValue', 'options'],
          emits: ['update:modelValue'],
          template:
            '<button v-bind="$attrs" data-test="select-stub" @click="$emit(`update:modelValue`, `reading`)"></button>',
        },
      },
    },
  });

describe('books search page', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    apiRequest.mockReset();
    toastAdd.mockReset();
    state.route = { fullPath: '/books/search' };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows minimum length hint for short queries', async () => {
    const wrapper = mountPage();
    await wrapper.get('[data-test="search-input"]').setValue('h');
    await vi.advanceTimersByTimeAsync(350);

    expect(apiRequest).not.toHaveBeenCalled();
    expect(wrapper.get('[data-test="search-hint"]').text()).toContain('at least 2');
  });

  it('searches books with debounce', async () => {
    apiRequest.mockResolvedValueOnce(
      searchResponse([
        {
          work_key: '/works/OL1W',
          title: 'Book A',
          author_names: ['Author A'],
          first_publish_year: 2000,
          cover_url: 'https://example.com/cover.jpg',
        },
      ]),
    );

    const wrapper = mountPage();

    await wrapper.get('[data-test="search-input"]').setValue('harry');
    await vi.advanceTimersByTimeAsync(350);

    expect(apiRequest).toHaveBeenCalledWith('/api/v1/books/search', {
      query: { query: 'harry', limit: 10, page: 1, sort: 'relevance' },
    });
    expect(wrapper.text()).toContain('Book A');
    expect(wrapper.find('[data-test="search-item-cover"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="search-item-cover-placeholder"]').exists()).toBe(false);
  });

  it('clears the prior debounce timer when query changes rapidly', async () => {
    apiRequest.mockResolvedValue(searchResponse([]));
    const wrapper = mountPage();

    await wrapper.get('[data-test="search-input"]').setValue('ha');
    await wrapper.get('[data-test="search-input"]').setValue('har');
    await vi.advanceTimersByTimeAsync(350);

    expect(apiRequest).toHaveBeenCalledTimes(1);
  });

  it('shows empty-state hint when no results are found', async () => {
    apiRequest.mockResolvedValueOnce(searchResponse([]));
    const wrapper = mountPage();

    await wrapper.get('[data-test="search-input"]').setValue('unknown');
    await vi.advanceTimersByTimeAsync(350);

    expect(wrapper.get('[data-test="search-hint"]').text()).toContain('No books found');
  });

  it('renders unknown author fallback and no first-publish label when missing', async () => {
    apiRequest.mockResolvedValueOnce(
      searchResponse([
        {
          work_key: '/works/OL1W',
          title: 'Book A',
          author_names: [],
          first_publish_year: null,
          cover_url: null,
        },
      ]),
    );

    const wrapper = mountPage();

    await wrapper.get('[data-test="search-input"]').setValue('harry');
    await vi.advanceTimersByTimeAsync(350);

    expect(wrapper.text()).toContain('Unknown author');
    expect(wrapper.text()).not.toContain('First published:');
  });

  it('shows api client errors from search calls', async () => {
    apiRequest.mockRejectedValueOnce(new ApiClientErrorMock('Auth required', 'auth_required', 401));
    const wrapper = mountPage();

    await wrapper.get('[data-test="search-input"]').setValue('harry');
    await vi.advanceTimersByTimeAsync(350);

    expect(wrapper.get('[data-test="search-error"]').text()).toContain('Auth required');
  });

  it('shows generic errors from search calls', async () => {
    apiRequest.mockRejectedValueOnce(new Error('boom'));
    const wrapper = mountPage();

    await wrapper.get('[data-test="search-input"]').setValue('harry');
    await vi.advanceTimersByTimeAsync(350);

    expect(wrapper.get('[data-test="search-error"]').text()).toContain('Unable to search');
  });

  it('imports and adds a searched book', async () => {
    apiRequest
      .mockResolvedValueOnce(
        searchResponse([
          {
            work_key: '/works/OL1W',
            title: 'Book A',
            author_names: ['Author A'],
            first_publish_year: 2000,
            cover_url: null,
          },
        ]),
      )
      .mockResolvedValueOnce({ work: { id: 'work-1' } })
      .mockResolvedValueOnce({ created: true });

    const wrapper = mountPage();

    await wrapper.get('[data-test="search-input"]').setValue('harry');
    await vi.advanceTimersByTimeAsync(350);
    await wrapper.get('[data-test="search-add-0"]').trigger('click');

    expect(apiRequest).toHaveBeenNthCalledWith(2, '/api/v1/books/import', {
      method: 'POST',
      body: { source: 'openlibrary', work_key: '/works/OL1W' },
    });
    expect(apiRequest).toHaveBeenNthCalledWith(3, '/api/v1/library/items', {
      method: 'POST',
      body: { work_id: 'work-1', status: 'to_read' },
    });
    expect(toastAdd).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'success', summary: expect.stringContaining('added') }),
    );
    expect(wrapper.get('[data-test="search-add-0"]').text()).toContain('Added');
    expect(wrapper.get('[data-test="search-add-0"]').attributes('disabled')).toBeDefined();
  });

  it('uses the currently selected status when adding to library', async () => {
    apiRequest
      .mockResolvedValueOnce(
        searchResponse([
          {
            work_key: '/works/OL1W',
            title: 'Book A',
            author_names: ['Author A'],
            first_publish_year: 2000,
            cover_url: null,
          },
        ]),
      )
      .mockResolvedValueOnce({ work: { id: 'work-1' } })
      .mockResolvedValueOnce({ created: true });

    const wrapper = mountPage();

    await wrapper.get('[data-test="status-select"]').trigger('click');
    await wrapper.get('[data-test="search-input"]').setValue('harry');
    await vi.advanceTimersByTimeAsync(350);
    await wrapper.get('[data-test="search-add-0"]').trigger('click');

    expect(apiRequest).toHaveBeenNthCalledWith(3, '/api/v1/library/items', {
      method: 'POST',
      body: { work_id: 'work-1', status: 'reading' },
    });
  });

  it('shows duplicate message when already in library', async () => {
    apiRequest
      .mockResolvedValueOnce(
        searchResponse([
          {
            work_key: '/works/OL1W',
            title: 'Book A',
            author_names: ['Author A'],
            first_publish_year: 2000,
            cover_url: null,
          },
        ]),
      )
      .mockResolvedValueOnce({ work: { id: 'work-1' } })
      .mockResolvedValueOnce({ created: false });

    const wrapper = mountPage();

    await wrapper.get('[data-test="search-input"]').setValue('harry');
    await vi.advanceTimersByTimeAsync(350);
    await wrapper.get('[data-test="search-add-0"]').trigger('click');

    expect(toastAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'success',
        summary: expect.stringContaining('already in your library'),
      }),
    );
    expect(wrapper.get('[data-test="search-add-0"]').text()).toContain('Already in library');
  });

  it('dispatches library updated event after successful add', async () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
    apiRequest
      .mockResolvedValueOnce(
        searchResponse([
          {
            work_key: '/works/OL1W',
            title: 'Book A',
            author_names: ['Author A'],
            first_publish_year: 2000,
            cover_url: null,
          },
        ]),
      )
      .mockResolvedValueOnce({ work: { id: 'work-1' } })
      .mockResolvedValueOnce({ created: true });

    const wrapper = mountPage();
    await wrapper.get('[data-test="search-input"]').setValue('harry');
    await vi.advanceTimersByTimeAsync(350);
    await wrapper.get('[data-test="search-add-0"]').trigger('click');

    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'chapterverse:library-updated' }),
    );
    dispatchSpy.mockRestore();
  });

  it('shows api client errors from import flow', async () => {
    apiRequest
      .mockResolvedValueOnce(
        searchResponse([
          {
            work_key: '/works/OL1W',
            title: 'Book A',
            author_names: ['Author A'],
            first_publish_year: 2000,
            cover_url: null,
          },
        ]),
      )
      .mockRejectedValueOnce(new ApiClientErrorMock('Import denied', 'denied', 403));

    const wrapper = mountPage();

    await wrapper.get('[data-test="search-input"]').setValue('harry');
    await vi.advanceTimersByTimeAsync(350);
    await wrapper.get('[data-test="search-add-0"]').trigger('click');

    expect(wrapper.get('[data-test="search-error"]').text()).toContain('Import denied');
  });

  it('shows generic errors from import flow', async () => {
    apiRequest
      .mockResolvedValueOnce(
        searchResponse([
          {
            work_key: '/works/OL1W',
            title: 'Book A',
            author_names: ['Author A'],
            first_publish_year: 2000,
            cover_url: null,
          },
        ]),
      )
      .mockRejectedValueOnce(new Error('boom'));

    const wrapper = mountPage();

    await wrapper.get('[data-test="search-input"]').setValue('harry');
    await vi.advanceTimersByTimeAsync(350);
    await wrapper.get('[data-test="search-add-0"]').trigger('click');

    expect(wrapper.get('[data-test="search-error"]').text()).toContain('Unable to import');
  });

  it('imports google books results using source_id', async () => {
    apiRequest
      .mockResolvedValueOnce(
        searchResponse([
          {
            work_key: 'googlebooks:gb1',
            source: 'googlebooks',
            source_id: 'gb1',
            title: 'Book A',
            author_names: ['Author A'],
            first_publish_year: 2000,
            cover_url: null,
          },
        ]),
      )
      .mockResolvedValueOnce({ work: { id: 'work-1' } })
      .mockResolvedValueOnce({ created: true });

    const wrapper = mountPage();
    await wrapper.get('[data-test="search-input"]').setValue('harry');
    await vi.advanceTimersByTimeAsync(350);
    await wrapper.get('[data-test="search-add-0"]').trigger('click');

    expect(apiRequest).toHaveBeenNthCalledWith(2, '/api/v1/books/import', {
      method: 'POST',
      body: { source: 'googlebooks', source_id: 'gb1' },
    });
  });

  it('normalizes google attribution with non-string url values', async () => {
    apiRequest.mockResolvedValueOnce(
      searchResponse([
        {
          work_key: 'googlebooks:gb1',
          source: 'googlebooks',
          title: 'Book A',
          author_names: ['Author A'],
          first_publish_year: 2000,
          cover_url: null,
          attribution: { text: 'From Google', url: 42 },
        },
      ]),
    );

    const wrapper = mountPage();
    await wrapper.get('[data-test="search-input"]').setValue('harry');
    await vi.advanceTimersByTimeAsync(350);

    expect(wrapper.text()).toContain('From Google');
    expect(apiRequest).toHaveBeenCalledWith('/api/v1/books/search', {
      query: { query: 'harry', limit: 10, page: 1, sort: 'relevance' },
    });
  });

  it('returns early when import is disabled for a work key', async () => {
    apiRequest
      .mockResolvedValueOnce(
        searchResponse([
          {
            work_key: '/works/OL1W',
            title: 'Book A',
            author_names: ['Author A'],
            first_publish_year: 2000,
            cover_url: null,
          },
        ]),
      )
      .mockResolvedValueOnce({ work: { id: 'work-1' } })
      .mockResolvedValueOnce({ created: true });

    const wrapper = mountPage();
    await wrapper.get('[data-test="search-input"]').setValue('harry');
    await vi.advanceTimersByTimeAsync(350);
    await wrapper.get('[data-test="search-add-0"]').trigger('click');

    const callsAfterFirstImport = apiRequest.mock.calls.length;
    await (wrapper.vm as any).importAndAdd({
      work_key: '/works/OL1W',
      source: 'openlibrary',
      source_id: '/works/OL1W',
      title: 'Book A',
      author_names: ['Author A'],
      first_publish_year: 2000,
      cover_url: null,
      edition_count: null,
      languages: [],
      readable: false,
      attribution: null,
    });
    expect(apiRequest.mock.calls.length).toBe(callsAfterFirstImport);
  });

  it('loadMore returns early when there is no next page', async () => {
    const wrapper = mountPage();
    await (wrapper.vm as any).loadMore();
    expect(apiRequest).not.toHaveBeenCalled();
  });

  it('re-runs search when filters change after query is active', async () => {
    apiRequest.mockResolvedValueOnce(searchResponse([])).mockResolvedValueOnce(searchResponse([]));

    const wrapper = mountPage();
    await wrapper.get('[data-test="search-input"]').setValue('harry');
    await vi.advanceTimersByTimeAsync(350);
    await wrapper.get('[data-test="search-language"]').setValue('eng');
    await vi.advanceTimersByTimeAsync(0);

    expect(apiRequest).toHaveBeenNthCalledWith(2, '/api/v1/books/search', {
      query: {
        query: 'harry',
        limit: 10,
        page: 1,
        sort: 'relevance',
        language: 'eng',
      },
    });
  });

  it('updates sort and re-runs search', async () => {
    apiRequest.mockResolvedValueOnce(searchResponse([])).mockResolvedValueOnce(searchResponse([]));
    const wrapper = mountPage();

    await wrapper.get('[data-test="search-input"]').setValue('harry');
    await vi.advanceTimersByTimeAsync(350);
    await wrapper.get('[data-test="search-sort"]').trigger('click');
    await vi.advanceTimersByTimeAsync(0);

    expect(apiRequest).toHaveBeenNthCalledWith(2, '/api/v1/books/search', {
      query: { query: 'harry', limit: 10, page: 1, sort: 'reading' },
    });
  });

  it('clears pending timer on unmount', async () => {
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    const wrapper = mountPage();
    await wrapper.get('[data-test="search-input"]').setValue('harry');
    wrapper.unmount();

    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });

  it('unmounts without a pending timer', () => {
    const wrapper = mountPage();
    expect(() => wrapper.unmount()).not.toThrow();
  });

  it('renders a placeholder thumbnail when cover_url is missing', async () => {
    apiRequest.mockResolvedValueOnce(
      searchResponse([
        {
          work_key: '/works/OL1W',
          title: 'Book A',
          author_names: ['Author A'],
          first_publish_year: 2000,
          cover_url: null,
        },
      ]),
    );

    const wrapper = mountPage();

    await wrapper.get('[data-test="search-input"]').setValue('harry');
    await vi.advanceTimersByTimeAsync(350);

    expect(wrapper.find('[data-test="search-item-cover-placeholder"]').exists()).toBe(true);
  });

  it('falls back to placeholder when cover image fails to load', async () => {
    apiRequest.mockResolvedValueOnce(
      searchResponse([
        {
          work_key: '/works/OL1W',
          title: 'Book A',
          author_names: ['Author A'],
          first_publish_year: 2000,
          cover_url: 'https://example.com/cover.jpg',
        },
      ]),
    );

    const wrapper = mountPage();
    await wrapper.get('[data-test="search-input"]').setValue('harry');
    await vi.advanceTimersByTimeAsync(350);
    await wrapper.get('[data-test="search-item-cover"]').trigger('error');

    expect(wrapper.find('[data-test="search-item-cover"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="search-item-cover-placeholder"]').exists()).toBe(true);
  });

  it('shows and uses load more to append additional pages', async () => {
    apiRequest
      .mockResolvedValueOnce(
        searchResponse(
          [
            {
              work_key: '/works/OL1W',
              title: 'Book A',
              author_names: ['Author A'],
              first_publish_year: 2000,
              cover_url: null,
            },
          ],
          2,
        ),
      )
      .mockResolvedValueOnce(
        searchResponse([
          {
            work_key: '/works/OL2W',
            title: 'Book B',
            author_names: ['Author B'],
            first_publish_year: 2001,
            cover_url: null,
          },
        ]),
      );

    const wrapper = mountPage();
    await wrapper.get('[data-test="search-input"]').setValue('harry');
    await vi.advanceTimersByTimeAsync(350);

    expect(wrapper.find('[data-test="search-load-more"]').exists()).toBe(true);
    await wrapper.get('[data-test="search-load-more"]').trigger('click');
    await Promise.resolve();

    expect(apiRequest).toHaveBeenNthCalledWith(2, '/api/v1/books/search', {
      query: { query: 'harry', limit: 10, page: 2, sort: 'relevance' },
    });
    expect(wrapper.text()).toContain('Book A');
    expect(wrapper.text()).toContain('Book B');
    expect(wrapper.find('[data-test="search-load-more"]').exists()).toBe(false);
  });

  it('keeps existing results when load more fails', async () => {
    apiRequest
      .mockResolvedValueOnce(
        searchResponse(
          [
            {
              work_key: '/works/OL1W',
              title: 'Book A',
              author_names: ['Author A'],
              first_publish_year: 2000,
              cover_url: null,
            },
          ],
          2,
        ),
      )
      .mockRejectedValueOnce(new ApiClientErrorMock('Try later', 'request_failed', 500));

    const wrapper = mountPage();
    await wrapper.get('[data-test="search-input"]').setValue('harry');
    await vi.advanceTimersByTimeAsync(350);
    await wrapper.get('[data-test="search-load-more"]').trigger('click');
    await Promise.resolve();

    expect(wrapper.text()).toContain('Book A');
    expect(wrapper.get('[data-test="search-error"]').text()).toContain('Try later');
  });

  it('shows generic message when load more throws a non-api error', async () => {
    apiRequest
      .mockResolvedValueOnce(
        searchResponse(
          [
            {
              work_key: '/works/OL1W',
              title: 'Book A',
              author_names: ['Author A'],
              first_publish_year: 2000,
              cover_url: null,
            },
          ],
          2,
        ),
      )
      .mockRejectedValueOnce(new Error('boom'));

    const wrapper = mountPage();
    await wrapper.get('[data-test="search-input"]').setValue('harry');
    await vi.advanceTimersByTimeAsync(350);
    await wrapper.get('[data-test="search-load-more"]').trigger('click');
    await Promise.resolve();

    expect(wrapper.get('[data-test="search-error"]').text()).toContain('Unable to load more');
  });

  it('ignores stale search error when a newer query succeeds', async () => {
    const firstSearch = deferred<ReturnType<typeof searchResponse>>();
    apiRequest
      .mockImplementationOnce(() => firstSearch.promise)
      .mockResolvedValueOnce(
        searchResponse([
          {
            work_key: '/works/OL2W',
            title: 'Book B',
            author_names: ['Author B'],
            first_publish_year: 2001,
            cover_url: null,
          },
        ]),
      );

    const wrapper = mountPage();
    await wrapper.get('[data-test="search-input"]').setValue('harry');
    await vi.advanceTimersByTimeAsync(350);
    await wrapper.get('[data-test="search-input"]').setValue('harriet');
    await vi.advanceTimersByTimeAsync(350);

    firstSearch.reject(new Error('stale error'));
    await Promise.resolve();
    await Promise.resolve();

    expect(wrapper.text()).toContain('Book B');
    expect(wrapper.find('[data-test="search-error"]').exists()).toBe(false);
  });

  it('ignores stale search success when a newer query succeeds', async () => {
    const firstSearch = deferred<ReturnType<typeof searchResponse>>();
    apiRequest
      .mockImplementationOnce(() => firstSearch.promise)
      .mockResolvedValueOnce(
        searchResponse([
          {
            work_key: '/works/OL2W',
            title: 'Book B',
            author_names: ['Author B'],
            first_publish_year: 2001,
            cover_url: null,
          },
        ]),
      );

    const wrapper = mountPage();
    await wrapper.get('[data-test="search-input"]').setValue('harry');
    await vi.advanceTimersByTimeAsync(350);
    await wrapper.get('[data-test="search-input"]').setValue('harriet');
    await vi.advanceTimersByTimeAsync(350);

    firstSearch.resolve(
      searchResponse([
        {
          work_key: '/works/OL1W',
          title: 'Book A',
          author_names: ['Author A'],
          first_publish_year: 2000,
          cover_url: null,
        },
      ]),
    );
    await Promise.resolve();
    await Promise.resolve();

    expect(wrapper.text()).toContain('Book B');
    expect(wrapper.text()).not.toContain('Book A');
  });

  it('ignores stale load-more response when query changes', async () => {
    const staleLoadMore = deferred<ReturnType<typeof searchResponse>>();
    apiRequest
      .mockResolvedValueOnce(
        searchResponse(
          [
            {
              work_key: '/works/OL1W',
              title: 'Book A',
              author_names: ['Author A'],
              first_publish_year: 2000,
              cover_url: null,
            },
          ],
          2,
        ),
      )
      .mockImplementationOnce(() => staleLoadMore.promise)
      .mockResolvedValueOnce(
        searchResponse([
          {
            work_key: '/works/OL9W',
            title: 'Book Z',
            author_names: ['Author Z'],
            first_publish_year: 2009,
            cover_url: null,
          },
        ]),
      );

    const wrapper = mountPage();
    await wrapper.get('[data-test="search-input"]').setValue('harry');
    await vi.advanceTimersByTimeAsync(350);
    await wrapper.get('[data-test="search-load-more"]').trigger('click');

    await wrapper.get('[data-test="search-input"]').setValue('zebra');
    await vi.advanceTimersByTimeAsync(350);
    staleLoadMore.resolve(
      searchResponse([
        {
          work_key: '/works/OL2W',
          title: 'Book B',
          author_names: ['Author B'],
          first_publish_year: 2001,
          cover_url: null,
        },
      ]),
    );
    await Promise.resolve();
    await Promise.resolve();

    expect(wrapper.text()).toContain('Book Z');
    expect(wrapper.text()).not.toContain('Book B');
  });

  it('ignores stale load-more error when query changes', async () => {
    const staleLoadMore = deferred<ReturnType<typeof searchResponse>>();
    apiRequest
      .mockResolvedValueOnce(
        searchResponse(
          [
            {
              work_key: '/works/OL1W',
              title: 'Book A',
              author_names: ['Author A'],
              first_publish_year: 2000,
              cover_url: null,
            },
          ],
          2,
        ),
      )
      .mockImplementationOnce(() => staleLoadMore.promise)
      .mockResolvedValueOnce(
        searchResponse([
          {
            work_key: '/works/OL9W',
            title: 'Book Z',
            author_names: ['Author Z'],
            first_publish_year: 2009,
            cover_url: null,
          },
        ]),
      );

    const wrapper = mountPage();
    await wrapper.get('[data-test="search-input"]').setValue('harry');
    await vi.advanceTimersByTimeAsync(350);
    await wrapper.get('[data-test="search-load-more"]').trigger('click');
    await wrapper.get('[data-test="search-input"]').setValue('zebra');
    await vi.advanceTimersByTimeAsync(350);

    staleLoadMore.reject(new Error('stale load more error'));
    await Promise.resolve();
    await Promise.resolve();

    expect(wrapper.find('[data-test="search-error"]').exists()).toBe(false);
    expect(wrapper.text()).toContain('Book Z');
  });

  it('passes advanced filters to books search', async () => {
    apiRequest.mockResolvedValueOnce(searchResponse([]));
    const wrapper = mountPage();
    await wrapper.get('[data-test="search-input"]').setValue('harry');
    await wrapper.get('[data-test="search-author"]').setValue('Rowling');
    await wrapper.get('[data-test="search-subject"]').setValue('Fantasy');
    await wrapper.get('[data-test="search-language"]').setValue('eng');
    await wrapper.get('[data-test="search-year-from"]').setValue('1990');
    await wrapper.get('[data-test="search-year-to"]').setValue('2000');
    await vi.advanceTimersByTimeAsync(350);
    await Promise.resolve();

    expect(apiRequest).toHaveBeenLastCalledWith('/api/v1/books/search', {
      query: {
        query: 'harry',
        limit: 10,
        page: 1,
        sort: 'relevance',
        author: 'Rowling',
        subject: 'Fantasy',
        language: 'eng',
        first_publish_year_from: 1990,
        first_publish_year_to: 2000,
      },
    });
  });

  it('renders metadata line with readability, languages, and edition count', async () => {
    apiRequest.mockResolvedValueOnce(
      searchResponse([
        {
          work_key: '/works/OL1W',
          title: 'Book A',
          author_names: ['Author A'],
          first_publish_year: 2000,
          cover_url: null,
          edition_count: 5,
          languages: ['eng', 'spa'],
          readable: true,
        } as any,
      ]),
    );
    const wrapper = mountPage();
    await wrapper.get('[data-test="search-input"]').setValue('harry');
    await vi.advanceTimersByTimeAsync(350);
    expect(wrapper.text()).toContain('Editions: 5');
    expect(wrapper.text()).toContain('Languages: eng, spa');
    expect(wrapper.text()).toContain('Readable online');
  });
});
