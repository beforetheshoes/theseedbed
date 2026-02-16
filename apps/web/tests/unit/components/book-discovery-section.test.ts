import { flushPromises, mount } from '@vue/test-utils';
import PrimeVue from 'primevue/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiRequest = vi.hoisted(() => vi.fn());
const navigateToMock = vi.hoisted(() => vi.fn());
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

vi.mock('#imports', () => ({
  navigateTo: navigateToMock,
}));

vi.mock('primevue/usetoast', () => ({
  useToast: () => ({ add: toastAdd }),
}));

import BookDiscoverySection from '../../../app/components/books/BookDiscoverySection.vue';

const mountSection = (
  authors: Array<{ id: string; name: string }> = [{ id: 'author-1', name: 'A' }],
) =>
  mount(BookDiscoverySection, {
    props: { workId: 'work-1', authors },
    global: {
      plugins: [[PrimeVue, { ripple: false }]],
      stubs: {
        Card: {
          template:
            '<section><header><slot name="title" /></header><div><slot name="content" /></div></section>',
        },
        Avatar: { template: '<div />' },
      },
    },
  });

describe('book discovery section', () => {
  beforeEach(() => {
    apiRequest.mockReset();
    navigateToMock.mockReset();
    toastAdd.mockReset();
  });

  it('shows empty states when no authors are provided', async () => {
    const wrapper = mountSection([]);
    await flushPromises();
    expect(wrapper.text()).toContain('No related books with covers yet.');
    expect(wrapper.text()).toContain('No author books with covers yet.');
  });

  it('loads related books and author works', async () => {
    apiRequest.mockImplementation(async (url: string, opts?: any) => {
      const method = (opts?.method || 'GET').toUpperCase();
      if (url === '/api/v1/works/work-1/related') {
        return {
          items: [
            {
              work_key: '/works/OL2W',
              title: 'Related One',
              cover_url: 'https://example.com/related.jpg',
            },
          ],
        };
      }
      if (url === '/api/v1/authors/author-1') {
        return {
          id: 'author-1',
          name: 'Author A',
          bio: 'Bio',
          photo_url: null,
          openlibrary_author_key: '/authors/OL1A',
          works: [
            {
              work_key: '/works/OL9W',
              title: 'Other Book',
              cover_url: 'https://example.com/other.jpg',
            },
          ],
        };
      }
      if (url === '/api/v1/books/import' && method === 'POST') {
        return { work: { id: 'work-2' } };
      }
      throw new Error(`unexpected request: ${method} ${url}`);
    });
    const wrapper = mountSection();
    await flushPromises();
    expect(wrapper.text()).toContain('Related One');
    expect(wrapper.text()).toContain('Unknown author');
    expect(wrapper.text()).toContain('Other Book');
    await wrapper.get('[data-test="related-book-/works/OL2W"]').trigger('click');
    await flushPromises();
    expect(navigateToMock).toHaveBeenCalledWith('/books/work-2');
  });

  it('renders cover-forward discovery cards and imports from author works', async () => {
    apiRequest.mockImplementation(async (url: string, opts?: any) => {
      const method = (opts?.method || 'GET').toUpperCase();
      if (url === '/api/v1/works/work-1/related') {
        return {
          items: [
            {
              work_key: '/works/OL2W',
              title: 'Related One',
              cover_url: 'https://example.com/related.jpg',
              first_publish_year: 2001,
              author_names: ['Author One, Author Two; Author Three'],
            },
          ],
        };
      }
      if (url === '/api/v1/authors/author-1') {
        return {
          id: 'author-1',
          name: 'Author A',
          bio: 'Bio',
          photo_url: 'https://example.com/author.jpg',
          openlibrary_author_key: '/authors/OL1A',
          works: [
            {
              work_key: '/works/OL9W',
              title: 'Other Book',
              cover_url: 'https://example.com/other.jpg',
            },
          ],
        };
      }
      if (url === '/api/v1/books/import' && method === 'POST') {
        const workKey = opts?.body?.work_key;
        return { work: { id: workKey === '/works/OL9W' ? 'work-9' : 'work-2' } };
      }
      throw new Error(`unexpected request: ${method} ${url}`);
    });

    const wrapper = mountSection();
    await flushPromises();

    expect(wrapper.find('[data-test="related-book-/works/OL2W"] img').exists()).toBe(true);
    expect(wrapper.text()).toContain('Author One');
    expect(wrapper.text()).not.toContain('Author Two');
    expect(wrapper.find('[data-test="author-work-/works/OL9W"] img').exists()).toBe(true);

    await wrapper.get('[data-test="author-work-/works/OL9W"]').trigger('click');
    await flushPromises();
    expect(navigateToMock).toHaveBeenCalledWith('/books/work-9');
  });

  it('reloads when work or author props change', async () => {
    apiRequest.mockImplementation(async (url: string) => {
      if (url === '/api/v1/works/work-1/related') return { items: [] };
      if (url === '/api/v1/authors/author-1') {
        return {
          id: 'author-1',
          name: 'Author A',
          bio: null,
          photo_url: null,
          openlibrary_author_key: '/authors/OL1A',
          works: [],
        };
      }
      if (url === '/api/v1/works/work-2/related') return { items: [] };
      if (url === '/api/v1/authors/author-2') {
        return {
          id: 'author-2',
          name: 'Author B',
          bio: null,
          photo_url: null,
          openlibrary_author_key: '/authors/OL2A',
          works: [],
        };
      }
      throw new Error(`unexpected request: ${url}`);
    });

    const wrapper = mountSection();
    await flushPromises();

    await wrapper.setProps({ workId: 'work-2', authors: [{ id: 'author-2', name: 'B' }] });
    await flushPromises();

    expect(apiRequest).toHaveBeenCalledWith('/api/v1/works/work-2/related');
    expect(apiRequest).toHaveBeenCalledWith('/api/v1/authors/author-2');
  });

  it('handles related payload without items array', async () => {
    apiRequest.mockImplementation(async (url: string) => {
      if (url === '/api/v1/works/work-1/related') return {} as any;
      if (url === '/api/v1/authors/author-1') {
        return {
          id: 'author-1',
          name: 'Author A',
          bio: null,
          photo_url: null,
          openlibrary_author_key: '/authors/OL1A',
          works: [],
        };
      }
      throw new Error(`unexpected request: ${url}`);
    });

    const wrapper = mountSection();
    await flushPromises();

    expect(wrapper.text()).toContain('No related books with covers yet.');
  });

  it('falls back to Unknown author when related author entry is blank', async () => {
    apiRequest.mockImplementation(async (url: string) => {
      if (url === '/api/v1/works/work-1/related') {
        return {
          items: [
            {
              work_key: '/works/OL2W',
              title: 'Related One',
              cover_url: 'https://example.com/related.jpg',
              author_names: ['   '],
            },
          ],
        };
      }
      if (url === '/api/v1/authors/author-1') {
        return {
          id: 'author-1',
          name: 'Author A',
          bio: null,
          photo_url: null,
          openlibrary_author_key: '/authors/OL1A',
          works: [],
        };
      }
      throw new Error(`unexpected request: ${url}`);
    });

    const wrapper = mountSection();
    await flushPromises();
    expect(wrapper.text()).toContain('Unknown author');
  });

  it('handles load failures', async () => {
    apiRequest.mockImplementation(async (url: string) => {
      if (url === '/api/v1/works/work-1/related') throw new Error('boom');
      if (url === '/api/v1/authors/author-1') throw new Error('boom');
      throw new Error(`unexpected request: ${url}`);
    });
    const wrapper = mountSection();
    await flushPromises();
    expect(wrapper.text()).toContain('No related books with covers yet.');
    expect(wrapper.text()).toContain('No author books with covers yet.');
  });

  it('skips missing authors and still renders available author works', async () => {
    apiRequest.mockImplementation(async (url: string) => {
      if (url === '/api/v1/works/work-1/related') {
        return { items: [] };
      }
      if (url === '/api/v1/authors/author-1') {
        throw new ApiClientErrorMock('Not found', 'not_found', 404);
      }
      if (url === '/api/v1/authors/author-2') {
        return {
          id: 'author-2',
          name: 'Author B',
          bio: null,
          photo_url: null,
          openlibrary_author_key: '/authors/OL2A',
          works: [
            {
              work_key: '/works/OL2W',
              title: 'Other Book',
              cover_url: 'https://example.com/other.jpg',
            },
          ],
        };
      }
      throw new Error(`unexpected request: ${url}`);
    });

    const wrapper = mountSection([
      { id: 'author-1', name: 'A' },
      { id: 'author-2', name: 'B' },
    ]);
    await flushPromises();

    expect(wrapper.text()).toContain('Other Book');
    expect(wrapper.text()).not.toContain('No author books with covers yet.');
  });

  it('shows import errors from api and generic failures', async () => {
    apiRequest.mockImplementation(async (url: string, opts?: any) => {
      const method = (opts?.method || 'GET').toUpperCase();
      if (url === '/api/v1/works/work-1/related') {
        return {
          items: [
            {
              work_key: '/works/OL2W',
              title: 'Related One',
              cover_url: 'https://example.com/related.jpg',
            },
          ],
        };
      }
      if (url === '/api/v1/authors/author-1') {
        return {
          id: 'author-1',
          name: 'Author A',
          bio: null,
          photo_url: null,
          openlibrary_author_key: '/authors/OL1A',
          works: [],
        };
      }
      if (url === '/api/v1/books/import' && method === 'POST') {
        throw new ApiClientErrorMock('Denied', 'forbidden', 403);
      }
      throw new Error(`unexpected request: ${method} ${url}`);
    });
    const wrapper = mountSection();
    await flushPromises();
    await wrapper.get('[data-test="related-book-/works/OL2W"]').trigger('click');
    await flushPromises();
    expect(toastAdd).toHaveBeenCalledWith(expect.objectContaining({ summary: 'Denied' }));

    apiRequest.mockImplementation(async (url: string, opts?: any) => {
      const method = (opts?.method || 'GET').toUpperCase();
      if (url === '/api/v1/works/work-1/related') {
        return {
          items: [
            {
              work_key: '/works/OL2W',
              title: 'Related One',
              cover_url: 'https://example.com/related.jpg',
            },
          ],
        };
      }
      if (url === '/api/v1/authors/author-1') {
        return {
          id: 'author-1',
          name: 'Author A',
          bio: null,
          photo_url: null,
          openlibrary_author_key: '/authors/OL1A',
          works: [],
        };
      }
      if (url === '/api/v1/books/import' && method === 'POST') {
        throw new Error('boom');
      }
      throw new Error(`unexpected request: ${method} ${url}`);
    });
    await wrapper.get('[data-test="related-book-/works/OL2W"]').trigger('click');
    await flushPromises();
    expect(toastAdd).toHaveBeenCalledWith(
      expect.objectContaining({ summary: 'Unable to open related book.' }),
    );
  });

  it('filters out books without covers', async () => {
    apiRequest.mockImplementation(async (url: string) => {
      if (url === '/api/v1/works/work-1/related') {
        return {
          items: [
            { work_key: '/works/OL2W', title: 'No Cover', cover_url: null },
            { work_key: '/works/OL3W', title: 'Has Cover', cover_url: 'https://example.com/x.jpg' },
          ],
        };
      }
      if (url === '/api/v1/authors/author-1') {
        return {
          id: 'author-1',
          name: 'Author A',
          bio: null,
          photo_url: null,
          openlibrary_author_key: '/authors/OL1A',
          works: [
            { work_key: '/works/OL4W', title: 'No Cover Work', cover_url: null },
            {
              work_key: '/works/OL5W',
              title: 'Cover Work',
              cover_url: 'https://example.com/y.jpg',
            },
          ],
        };
      }
      throw new Error(`unexpected request: ${url}`);
    });

    const wrapper = mountSection();
    await flushPromises();
    expect(wrapper.text()).not.toContain('No Cover');
    expect(wrapper.text()).toContain('Has Cover');
    expect(wrapper.text()).not.toContain('No Cover Work');
    expect(wrapper.text()).toContain('Cover Work');
  });
});
