import { flushPromises, mount } from '@vue/test-utils';
import PrimeVue from 'primevue/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  // Use a reactive route so the page-level `watch(workId)` can be covered in tests.
  route: (() => {
    const { reactive } = require('vue');
    return reactive({ fullPath: '/books/work-1', params: { workId: 'work-1' } });
  })(),
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

import BookDetailPage from '../../../app/pages/books/[workId].vue';

const mountPage = () =>
  mount(BookDetailPage, {
    global: {
      plugins: [[PrimeVue, { ripple: false }]],
      stubs: {
        NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
        Card: {
          template:
            '<section><header><slot name="title" /></header><div><slot name="content" /></div></section>',
        },
        Dialog: {
          name: 'Dialog',
          props: ['visible', 'header'],
          emits: ['update:visible'],
          template:
            '<div v-if="visible" data-test="dialog"><slot /></div><div v-else data-test="dialog-hidden"></div>',
        },
        Button: {
          props: ['label', 'loading'],
          emits: ['click'],
          template:
            '<button :disabled="loading" @click="$emit(`click`, $event)"><slot :class="`p-button`">{{ label }}</slot></button>',
        },
        InputText: {
          props: ['modelValue', 'placeholder'],
          emits: ['update:modelValue'],
          template:
            '<input :value="modelValue" :placeholder="placeholder" @input="$emit(`update:modelValue`, $event.target.value)" />',
        },
        Textarea: {
          props: ['modelValue', 'placeholder'],
          emits: ['update:modelValue'],
          template:
            '<textarea :value="modelValue" :placeholder="placeholder" @input="$emit(`update:modelValue`, $event.target.value)"></textarea>',
        },
        Select: {
          props: ['modelValue', 'options', 'optionLabel', 'optionValue'],
          emits: ['update:modelValue'],
          template: `
            <select
              :value="String(modelValue)"
              @change="
                (() => {
                  const raw = $event.target.value
                  const match = Array.isArray(options)
                    ? options.find((o) => String(o?.value) === raw)
                    : null
                  $emit('update:modelValue', match ? match.value : raw)
                })()
              "
            >
              <option v-for="o in options" :key="String(o.value)" :value="String(o.value)">
                {{ o.label }}
              </option>
            </select>
          `,
        },
        Rating: {
          props: ['modelValue', 'stars', 'cancel'],
          emits: ['update:modelValue'],
          template:
            '<div data-test="rating-stub"><button v-for="n in (stars || 5)" :key="n" :aria-label="`${n} stars`" @click="$emit(`update:modelValue`, n)">{{ n }}</button><button v-if="cancel" aria-label="Clear" @click="$emit(`update:modelValue`, null)">Clear</button></div>',
        },
        Timeline: {
          props: ['value', 'align'],
          template:
            '<div data-test="timeline-stub"><div v-for="item in value" :key="item.id"><slot name="marker" /><slot name="content" :item="item" /></div></div>',
        },
        Message: {
          props: ['severity', 'closable'],
          template:
            '<div :class="`p-message-${severity}`" :data-test="$attrs[`data-test`]"><slot /></div>',
          inheritAttrs: false,
        },
        Skeleton: {
          props: ['width', 'height', 'borderRadius', 'shape', 'size'],
          template: '<div class="p-skeleton"></div>',
        },
        Image: {
          props: ['src', 'preview', 'imageClass'],
          template: '<div v-bind="$attrs"><img :src="src" alt="" /></div>',
        },
        Checkbox: {
          props: ['modelValue', 'binary', 'inputId'],
          emits: ['update:modelValue'],
          template:
            '<input :id="inputId" type="checkbox" :checked="!!modelValue" @change="$emit(`update:modelValue`, $event.target.checked)" />',
        },
        FileUpload: {
          props: ['accept', 'chooseLabel', 'mode', 'multiple', 'name'],
          emits: ['select'],
          template:
            '<input type="file" :accept="accept" @change="$emit(`select`, { originalEvent: $event, files: Array.from($event.target.files || []) })" />',
        },
      },
    },
  });

const clickButton = async (wrapper: any, label: string, index = 0) => {
  const buttons = wrapper.findAll('button').filter((b: any) => b.text() === label);
  expect(buttons.length).toBeGreaterThan(index);
  await buttons[index].trigger('click');
};

const emitDialogVisible = async (wrapper: any, header: string, visible: boolean) => {
  const dialogs = wrapper.findAllComponents({ name: 'Dialog' });
  const match = dialogs.find((d: any) => d.props?.('header') === header);
  expect(match).toBeTruthy();
  match!.vm.$emit('update:visible', visible);
  await flushPromises();
};

describe('book detail page', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-08T00:00:00.000Z'));
    apiRequest.mockReset();
    state.route.fullPath = '/books/work-1';
    state.route.params.workId = 'work-1';
  });

  it('shows not-in-library view when by-work returns 404', async () => {
    apiRequest.mockImplementation(async (url: string) => {
      if (url === '/api/v1/works/work-1') {
        return {
          id: 'work-1',
          title: 'Book A',
          description: null,
          cover_url: null,
          authors: [],
        };
      }
      if (url === '/api/v1/library/items/by-work/work-1') {
        throw new ApiClientErrorMock('Not found', 'not_found', 404);
      }
      throw new Error(`unexpected request: ${url}`);
    });

    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.text()).not.toContain('Back to library');
    expect(wrapper.text()).toContain('This book is not in your library yet.');
    // When a book has no cover, show an explicit placeholder (not a skeleton).
    expect(wrapper.findAll('[data-test="book-detail-cover-placeholder"]').length).toBe(1);
    expect(apiRequest).toHaveBeenCalledWith('/api/v1/works/work-1');
    expect(apiRequest).toHaveBeenCalledWith('/api/v1/library/items/by-work/work-1');
  });

  it('loads details and supports CRUD flows (happy path)', async () => {
    const sessions: any[] = [];
    const notes: any[] = [];
    const highlights: any[] = [];
    let review: any = {
      id: 'review-1',
      work_id: 'work-1',
      title: 'Initial title',
      body: 'Initial body',
      visibility: 'unlisted',
      rating: 4,
    };

    apiRequest.mockImplementation(async (url: string, opts?: any) => {
      const method = (opts?.method || 'GET').toUpperCase();

      if (url === '/api/v1/works/work-1' && method === 'GET') {
        return {
          id: 'work-1',
          title: 'Book A',
          description: 'A description',
          cover_url: 'https://example.com/cover.jpg',
          authors: [{ id: 'author-1', name: 'Author A' }],
        };
      }

      if (url === '/api/v1/library/items/by-work/work-1' && method === 'GET') {
        return {
          id: 'item-1',
          work_id: 'work-1',
          preferred_edition_id: 'edition-1',
          status: 'reading',
          created_at: '2026-02-01',
        };
      }

      if (url === '/api/v1/library/items/item-1/sessions' && method === 'GET') {
        return { items: [...sessions] };
      }
      if (url === '/api/v1/library/items/item-1/notes' && method === 'GET') {
        return { items: [...notes] };
      }
      if (url === '/api/v1/library/items/item-1/highlights' && method === 'GET') {
        return { items: [...highlights] };
      }

      if (url === '/api/v1/me/reviews' && method === 'GET') {
        return { items: review ? [review] : [] };
      }

      if (url === '/api/v1/library/items/item-1/sessions' && method === 'POST') {
        sessions.unshift({
          id: 'session-1',
          started_at: opts?.body?.started_at,
          pages_read: opts?.body?.pages_read,
          progress_percent: opts?.body?.progress_percent,
          note: opts?.body?.note,
        });
        return { id: 'session-1' };
      }

      if (url === '/api/v1/library/items/item-1/notes' && method === 'POST') {
        notes.unshift({
          id: 'note-1',
          title: opts?.body?.title ?? null,
          body: opts?.body?.body,
          visibility: opts?.body?.visibility,
          created_at: '2026-02-08T00:00:00Z',
        });
        return { id: 'note-1' };
      }

      if (url === '/api/v1/notes/note-1' && method === 'PATCH') {
        notes[0] = { ...notes[0], ...opts?.body };
        return { id: 'note-1' };
      }

      if (url === '/api/v1/notes/note-1' && method === 'DELETE') {
        notes.splice(0, notes.length);
        return { ok: true };
      }

      if (url === '/api/v1/library/items/item-1/highlights' && method === 'POST') {
        highlights.unshift({
          id: 'highlight-1',
          quote: opts?.body?.quote,
          visibility: opts?.body?.visibility,
          created_at: '2026-02-08T00:00:00Z',
        });
        return { id: 'highlight-1' };
      }

      if (url === '/api/v1/highlights/highlight-1' && method === 'PATCH') {
        highlights[0] = { ...highlights[0], ...opts?.body };
        return { id: 'highlight-1' };
      }

      if (url === '/api/v1/highlights/highlight-1' && method === 'DELETE') {
        highlights.splice(0, highlights.length);
        return { ok: true };
      }

      if (url === '/api/v1/works/work-1/review' && method === 'POST') {
        review = { ...(review || { id: 'review-1', work_id: 'work-1' }), ...opts?.body };
        return { id: 'review-1' };
      }

      throw new Error(`unexpected request: ${method} ${url}`);
    });

    const wrapper = mountPage();
    await flushPromises();

    // Initial render exercises not-loaded -> loaded states and seeded review.
    expect(wrapper.text()).toContain('Book A');
    expect(wrapper.text()).toContain('Author A');
    expect(wrapper.text()).toContain('Reading');
    expect(wrapper.text()).toContain('No sessions yet.');
    expect(wrapper.text()).toContain('No notes yet.');
    expect(wrapper.text()).toContain('No highlights yet.');
    expect((wrapper.vm as any).reviewTitle).toBe('Initial title');
    expect((wrapper.vm as any).reviewBody).toBe('Initial body');

    // Log a session
    await wrapper.find('input[placeholder="Pages read"]').setValue('12');
    await wrapper.find('input[placeholder="Progress % (0-100)"]').setValue('25');
    await wrapper.find('textarea[placeholder="Session note"]').setValue('Felt great');
    await clickButton(wrapper, 'Log session');
    await flushPromises();
    expect(wrapper.text()).toContain('Pages: 12');
    expect(wrapper.text()).toContain('Progress: 25');
    expect(wrapper.text()).toContain('Felt great');

    // Log a session with blank progress to cover nullish fallbacks in the template (?? '-')
    await wrapper.find('input[placeholder="Pages read"]').setValue('');
    await wrapper.find('input[placeholder="Progress % (0-100)"]').setValue('');
    await wrapper.find('textarea[placeholder="Session note"]').setValue('');
    await clickButton(wrapper, 'Log session');
    await flushPromises();
    expect(wrapper.text()).toContain('Pages: -');
    expect(wrapper.text()).toContain('Progress: -');

    // Add note (covers early-return guard by trying empty body first)
    await clickButton(wrapper, 'Add note');
    await flushPromises();
    expect(apiRequest).not.toHaveBeenCalledWith('/api/v1/library/items/item-1/notes', {
      method: 'POST',
      body: expect.anything(),
    });

    // Change note visibility select (covers v-model + select binding)
    let selects = wrapper.findAll('select');
    expect(selects.length).toBeGreaterThanOrEqual(3);
    await selects[0].setValue('public');

    await wrapper.find('input[placeholder="Title (optional)"]').setValue('Note title');
    await wrapper.find('textarea[placeholder="Write a note..."]').setValue('My note body');
    await clickButton(wrapper, 'Add note');
    await flushPromises();
    expect(wrapper.text()).toContain('Note title');
    expect(wrapper.text()).toContain('My note body');

    // Edit note (opens dialog + saves)
    await clickButton(wrapper, 'Edit');
    await flushPromises();
    expect(wrapper.find('[data-test="dialog"]').exists()).toBe(true);

    // Exercise Dialog v-model handler by emitting an update from the stub.
    wrapper.findComponent({ name: 'Dialog' }).vm.$emit('update:visible', false);
    await flushPromises();
    expect(wrapper.find('[data-test="dialog"]').exists()).toBe(false);

    // Cancel path
    await clickButton(wrapper, 'Edit');
    await flushPromises();
    await clickButton(wrapper, 'Cancel');
    await flushPromises();
    expect(wrapper.find('[data-test="dialog"]').exists()).toBe(false);

    // Re-open and save
    await clickButton(wrapper, 'Edit');
    await flushPromises();
    // Update dialog fields (covers editNoteTitle + editNoteVisibility bindings)
    await wrapper
      .get('[data-test="dialog"]')
      .find('input[placeholder="Title (optional)"]')
      .setValue('Edited title');
    selects = wrapper.findAll('select');
    expect(selects.length).toBeGreaterThanOrEqual(4);
    await selects[1].setValue('unlisted');
    await wrapper.get('[data-test="dialog"]').find('textarea').setValue('Updated body');
    await clickButton(wrapper, 'Save');
    await flushPromises();
    expect(wrapper.text()).toContain('Updated body');

    // Delete note (first Delete button in DOM should be note delete)
    await clickButton(wrapper, 'Delete', 0);
    await flushPromises();
    expect(wrapper.text()).toContain('No notes yet.');

    // Add highlight (covers early-return guard by trying empty quote first)
    await clickButton(wrapper, 'Add highlight');
    await flushPromises();
    expect(wrapper.text()).toContain('No highlights yet.');

    // Change highlight visibility select (covers v-model + select binding)
    selects = wrapper.findAll('select');
    expect(selects.length).toBeGreaterThanOrEqual(3);
    await selects[1].setValue('public');

    await wrapper.find('input[placeholder="Location (optional)"]').setValue('10');
    await wrapper
      .find('textarea[placeholder="Paste a short excerpt..."]')
      .setValue('A short excerpt');
    await clickButton(wrapper, 'Add highlight');
    await flushPromises();
    expect(wrapper.text()).toContain('A short excerpt');

    // Edit highlight
    await clickButton(wrapper, 'Edit');
    await flushPromises();
    expect((wrapper.vm as any).editHighlightVisible).toBe(true);
    expect(wrapper.find('[data-test="dialog"]').exists()).toBe(true);
    // Cover dialog bindings + cancel path
    selects = wrapper.get('[data-test="dialog"]').findAll('select');
    expect(selects.length).toBeGreaterThanOrEqual(1);
    await selects[0].setValue('unlisted');
    await wrapper
      .get('[data-test="dialog"]')
      .find('input[placeholder="Location (optional)"]')
      .setValue('11');
    await clickButton(wrapper, 'Cancel');
    await flushPromises();
    expect(wrapper.find('[data-test="dialog"]').exists()).toBe(false);
    // Cover the v-model update handler generated for the dialog itself.
    await emitDialogVisible(wrapper, 'Edit highlight', false);

    await clickButton(wrapper, 'Edit');
    await flushPromises();
    await wrapper.get('[data-test="dialog"]').find('textarea').setValue('Updated excerpt');
    await clickButton(wrapper, 'Save');
    await flushPromises();
    expect(wrapper.text()).toContain('Updated excerpt');

    // Delete highlight (note was deleted earlier, so only one Delete button remains)
    await clickButton(wrapper, 'Delete', 0);
    await flushPromises();
    expect(wrapper.text()).toContain('No highlights yet.');

    // Save review (ensures API call uses trimmed/null behavior)
    // Set review visibility select and rating via Rating stub
    selects = wrapper.findAll('select');
    expect(selects.length).toBeGreaterThanOrEqual(3);
    await selects[2].setValue('public'); // review visibility

    // Click the 5th star button in the Rating stub (= 5 rating)
    const ratingStub = wrapper.get('[data-test="rating-stub"]');
    const ratingButtons = ratingStub
      .findAll('button')
      .filter((b) => b.attributes('aria-label')?.includes('stars'));
    await ratingButtons[ratingButtons.length - 1].trigger('click');

    // There are multiple "Title (optional)" inputs; pick the last one for review.
    const titleInputs = wrapper.findAll('input[placeholder="Title (optional)"]');
    await titleInputs[titleInputs.length - 1].setValue('  New title  ');
    await wrapper.find('textarea[placeholder="Write your review..."]').setValue('New body');
    await clickButton(wrapper, 'Save review');
    await flushPromises();
    expect(apiRequest).toHaveBeenCalledWith('/api/v1/works/work-1/review', {
      method: 'POST',
      body: expect.objectContaining({
        title: 'New title',
        body: 'New body',
        rating: 5,
        visibility: 'public',
      }),
    });
  });

  it('renders core content without waiting on section loaders', async () => {
    let resolveSessions: any = null;
    const sessionsPromise = new Promise((resolve) => {
      resolveSessions = resolve;
    });

    apiRequest.mockImplementation(async (url: string, opts?: any) => {
      const method = (opts?.method || 'GET').toUpperCase();
      if (url === '/api/v1/works/work-1' && method === 'GET') {
        return {
          id: 'work-1',
          title: 'Book A',
          description: null,
          cover_url: null,
          authors: [{ id: 'author-1', name: 'Author A' }],
        };
      }
      if (url === '/api/v1/library/items/by-work/work-1' && method === 'GET') {
        return {
          id: 'item-1',
          work_id: 'work-1',
          preferred_edition_id: 'edition-1',
          status: 'reading',
          created_at: '2026-02-01',
        };
      }
      if (url === '/api/v1/library/items/item-1/sessions' && method === 'GET') {
        return sessionsPromise as any;
      }
      if (url === '/api/v1/library/items/item-1/notes' && method === 'GET') {
        return new Promise(() => undefined) as any;
      }
      if (url === '/api/v1/library/items/item-1/highlights' && method === 'GET') {
        return new Promise(() => undefined) as any;
      }
      if (url === '/api/v1/me/reviews' && method === 'GET') {
        return new Promise(() => undefined) as any;
      }

      throw new Error(`unexpected request: ${method} ${url}`);
    });

    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.text()).toContain('Book A');
    expect(wrapper.text()).toContain('Author A');
    // Sessions section shows skeleton loading (no text), just verify it doesn't show "No sessions yet."
    expect(wrapper.text()).not.toContain('No sessions yet.');

    resolveSessions?.({ items: [] });
    await flushPromises();
    expect(wrapper.text()).toContain('No sessions yet.');
  });

  it('shows per-section error and retry only re-requests the failed section', async () => {
    const counts: Record<string, number> = {};
    const count = (url: string) => {
      counts[url] = (counts[url] || 0) + 1;
    };

    apiRequest.mockImplementation(async (url: string, opts?: any) => {
      count(url);
      const method = (opts?.method || 'GET').toUpperCase();

      if (url === '/api/v1/works/work-1' && method === 'GET') {
        return {
          id: 'work-1',
          title: 'Book A',
          description: null,
          cover_url: null,
          authors: [],
        };
      }
      if (url === '/api/v1/library/items/by-work/work-1' && method === 'GET') {
        return {
          id: 'item-1',
          work_id: 'work-1',
          preferred_edition_id: 'edition-1',
          status: 'reading',
          created_at: '2026-02-01',
        };
      }

      if (url === '/api/v1/library/items/item-1/sessions' && method === 'GET') {
        if ((counts[url] || 0) === 1) throw new Error('boom');
        return { items: [] };
      }
      if (url === '/api/v1/library/items/item-1/notes' && method === 'GET') return { items: [] };
      if (url === '/api/v1/library/items/item-1/highlights' && method === 'GET')
        return { items: [] };
      if (url === '/api/v1/me/reviews' && method === 'GET') return { items: [] };

      throw new Error(`unexpected request: ${method} ${url}`);
    });

    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.text()).toContain('Book A');
    expect(wrapper.text()).toContain('Unable to load sessions.');

    expect(counts['/api/v1/library/items/item-1/sessions']).toBe(1);
    expect(counts['/api/v1/library/items/item-1/notes']).toBe(1);
    expect(counts['/api/v1/library/items/item-1/highlights']).toBe(1);
    expect(counts['/api/v1/me/reviews']).toBe(1);

    await wrapper.get('[data-test="sessions-retry"]').trigger('click');
    await flushPromises();

    expect(counts['/api/v1/library/items/item-1/sessions']).toBe(2);
    expect(counts['/api/v1/library/items/item-1/notes']).toBe(1);
    expect(counts['/api/v1/library/items/item-1/highlights']).toBe(1);
    expect(counts['/api/v1/me/reviews']).toBe(1);
  });

  it('surfaces review load errors and allows retry', async () => {
    let reviewCalls = 0;
    apiRequest.mockImplementation(async (url: string, opts?: any) => {
      const method = (opts?.method || 'GET').toUpperCase();

      if (url === '/api/v1/works/work-1' && method === 'GET') {
        return { id: 'work-1', title: 'Book A', description: null, cover_url: null, authors: [] };
      }
      if (url === '/api/v1/library/items/by-work/work-1' && method === 'GET') {
        return {
          id: 'item-1',
          work_id: 'work-1',
          preferred_edition_id: 'edition-1',
          status: 'reading',
          created_at: '2026-02-01',
        };
      }
      if (url === '/api/v1/library/items/item-1/sessions' && method === 'GET') return { items: [] };
      if (url === '/api/v1/library/items/item-1/notes' && method === 'GET') return { items: [] };
      if (url === '/api/v1/library/items/item-1/highlights' && method === 'GET')
        return { items: [] };

      if (url === '/api/v1/me/reviews' && method === 'GET') {
        reviewCalls += 1;
        if (reviewCalls === 1) throw new ApiClientErrorMock('Nope', 'forbidden', 403);
        return { items: [] };
      }

      throw new Error(`unexpected request: ${method} ${url}`);
    });

    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.text()).toContain('Nope');
    expect(reviewCalls).toBe(1);

    await wrapper.get('[data-test="review-retry"]').trigger('click');
    await flushPromises();

    expect(reviewCalls).toBe(2);
    expect(wrapper.text()).not.toContain('Nope');
  });

  it('refetches when the route workId changes', async () => {
    apiRequest.mockImplementation(async (url: string, opts?: any) => {
      const method = (opts?.method || 'GET').toUpperCase();

      if (url === '/api/v1/works/work-1' && method === 'GET') {
        return { id: 'work-1', title: 'Book A', description: null, cover_url: null, authors: [] };
      }
      if (url === '/api/v1/library/items/by-work/work-1' && method === 'GET') {
        return {
          id: 'item-1',
          work_id: 'work-1',
          preferred_edition_id: 'edition-1',
          status: 'reading',
          created_at: '2026-02-01',
        };
      }
      if (url === '/api/v1/works/work-2' && method === 'GET') {
        return { id: 'work-2', title: 'Book B', description: null, cover_url: null, authors: [] };
      }
      if (url === '/api/v1/library/items/by-work/work-2' && method === 'GET') {
        throw new ApiClientErrorMock('Not found', 'not_found', 404);
      }

      // The per-section loaders should never run for work-2 because it is not in the library.
      if (url.startsWith('/api/v1/library/items/') || url === '/api/v1/me/reviews') {
        return { items: [] };
      }

      throw new Error(`unexpected request: ${method} ${url}`);
    });

    const wrapper = mountPage();
    await flushPromises();
    expect(wrapper.text()).toContain('Book A');

    state.route.fullPath = '/books/work-2';
    state.route.params.workId = 'work-2';
    await flushPromises();

    expect(apiRequest).toHaveBeenCalledWith('/api/v1/works/work-2');
    expect(wrapper.text()).toContain('Book B');
    expect(wrapper.text()).toContain('This book is not in your library yet.');
  });

  it('ignores stale core responses when workId changes mid-request', async () => {
    let resolveWork1: any = null;
    const work1Promise = new Promise((resolve) => {
      resolveWork1 = resolve;
    });

    apiRequest.mockImplementation(async (url: string, opts?: any) => {
      const method = (opts?.method || 'GET').toUpperCase();
      if (url === '/api/v1/works/work-1' && method === 'GET') return work1Promise as any;
      if (url === '/api/v1/library/items/by-work/work-1' && method === 'GET') {
        return {
          id: 'item-1',
          work_id: 'work-1',
          preferred_edition_id: 'edition-1',
          status: 'reading',
          created_at: '2026-02-01',
        };
      }

      if (url === '/api/v1/works/work-2' && method === 'GET') {
        return { id: 'work-2', title: 'Book B', description: null, cover_url: null, authors: [] };
      }
      if (url === '/api/v1/library/items/by-work/work-2' && method === 'GET') {
        throw new ApiClientErrorMock('Not found', 'not_found', 404);
      }

      if (url.startsWith('/api/v1/library/items/') || url === '/api/v1/me/reviews') {
        return { items: [] };
      }

      throw new Error(`unexpected request: ${method} ${url}`);
    });

    const wrapper = mountPage();

    // Trigger a route change while the initial `/works/work-1` request is still pending.
    state.route.fullPath = '/books/work-2';
    state.route.params.workId = 'work-2';

    resolveWork1?.({
      id: 'work-1',
      title: 'Book A',
      description: null,
      cover_url: null,
      authors: [],
    });
    await flushPromises();

    expect(wrapper.text()).toContain('Book B');
    expect(wrapper.text()).not.toContain('Book A');
  });

  it('abandons in-flight section loaders when workId changes', async () => {
    let resolveSessions: any = null;
    let resolveNotes: any = null;
    let resolveHighlights: any = null;
    let resolveReviews: any = null;

    const sessionsPromise = new Promise((resolve) => {
      resolveSessions = resolve;
    });
    const notesPromise = new Promise((resolve) => {
      resolveNotes = resolve;
    });
    const highlightsPromise = new Promise((resolve) => {
      resolveHighlights = resolve;
    });
    const reviewsPromise = new Promise((resolve) => {
      resolveReviews = resolve;
    });

    apiRequest.mockImplementation(async (url: string, opts?: any) => {
      const method = (opts?.method || 'GET').toUpperCase();
      if (url === '/api/v1/works/work-1' && method === 'GET') {
        return { id: 'work-1', title: 'Book A', description: null, cover_url: null, authors: [] };
      }
      if (url === '/api/v1/library/items/by-work/work-1' && method === 'GET') {
        return {
          id: 'item-1',
          work_id: 'work-1',
          preferred_edition_id: 'edition-1',
          status: 'reading',
          created_at: '2026-02-01',
        };
      }
      if (url === '/api/v1/library/items/item-1/sessions' && method === 'GET')
        return sessionsPromise as any;
      if (url === '/api/v1/library/items/item-1/notes' && method === 'GET')
        return notesPromise as any;
      if (url === '/api/v1/library/items/item-1/highlights' && method === 'GET')
        return highlightsPromise as any;
      if (url === '/api/v1/me/reviews' && method === 'GET') return reviewsPromise as any;

      if (url === '/api/v1/works/work-2' && method === 'GET') {
        return { id: 'work-2', title: 'Book B', description: null, cover_url: null, authors: [] };
      }
      if (url === '/api/v1/library/items/by-work/work-2' && method === 'GET') {
        throw new ApiClientErrorMock('Not found', 'not_found', 404);
      }

      throw new Error(`unexpected request: ${method} ${url}`);
    });

    const wrapper = mountPage();
    await flushPromises();
    expect(wrapper.text()).toContain('Book A');

    // Change workId while section loaders are still pending.
    state.route.fullPath = '/books/work-2';
    state.route.params.workId = 'work-2';
    await flushPromises();
    expect(wrapper.text()).toContain('Book B');

    // Resolve the previous work's section loaders after the route change.
    resolveSessions?.({ items: [] });
    resolveNotes?.({ items: [] });
    resolveHighlights?.({ items: [] });
    resolveReviews?.({ items: [] });
    await flushPromises();

    // Still on the new work (not in library), so the old section results must be ignored.
    expect(wrapper.text()).toContain('Book B');
    expect(wrapper.text()).toContain('This book is not in your library yet.');
  });

  it('supports setting cover via upload for preferred edition', async () => {
    const calls: Array<{ url: string; opts?: any }> = [];
    apiRequest.mockImplementation(async (url: string, opts?: any) => {
      calls.push({ url, opts });
      const method = (opts?.method || 'GET').toUpperCase();

      if (url === '/api/v1/works/work-1' && method === 'GET') {
        return {
          id: 'work-1',
          title: 'Book A',
          description: null,
          cover_url: null,
          authors: [],
        };
      }
      if (url === '/api/v1/library/items/by-work/work-1' && method === 'GET') {
        return {
          id: 'item-1',
          work_id: 'work-1',
          preferred_edition_id: 'edition-1',
          status: 'reading',
          created_at: '2026-02-01',
        };
      }
      if (url === '/api/v1/library/items/item-1/sessions' && method === 'GET') return { items: [] };
      if (url === '/api/v1/library/items/item-1/notes' && method === 'GET') return { items: [] };
      if (url === '/api/v1/library/items/item-1/highlights' && method === 'GET')
        return { items: [] };
      if (url === '/api/v1/me/reviews' && method === 'GET') return { items: [] };

      if (url === '/api/v1/editions/edition-1/cover' && method === 'POST') {
        return { cover_url: 'https://example.com/cover.jpg' };
      }

      throw new Error(`unexpected request: ${method} ${url}`);
    });

    const wrapper = mountPage();
    await flushPromises();

    await clickButton(wrapper, 'Set cover');
    await flushPromises();
    // Cover the v-model update handler generated for the dialog itself.
    await emitDialogVisible(wrapper, 'Set cover', true);

    (wrapper.vm as any).coverFile = new File(['x'], 'cover.jpg', { type: 'image/jpeg' });
    await (wrapper.vm as any).uploadCover();
    await flushPromises();

    const uploadCall = calls.find((c) => c.url === '/api/v1/editions/edition-1/cover');
    expect(uploadCall).toBeTruthy();
    expect(uploadCall?.opts?.body).toBeInstanceOf(FormData);
  });

  it('loads editions when preferred edition is missing and can cache cover + set preferred', async () => {
    let byWorkCount = 0;
    apiRequest.mockImplementation(async (url: string, opts?: any) => {
      const method = (opts?.method || 'GET').toUpperCase();

      if (url === '/api/v1/works/work-1' && method === 'GET') {
        return {
          id: 'work-1',
          title: 'Book A',
          description: null,
          cover_url: null,
          authors: [],
        };
      }
      if (url === '/api/v1/library/items/by-work/work-1' && method === 'GET') {
        byWorkCount += 1;
        return {
          id: 'item-1',
          work_id: 'work-1',
          preferred_edition_id: byWorkCount >= 2 ? 'edition-2' : null,
          status: 'reading',
          created_at: '2026-02-01',
        };
      }
      if (url === '/api/v1/library/items/item-1/sessions' && method === 'GET') return { items: [] };
      if (url === '/api/v1/library/items/item-1/notes' && method === 'GET') return { items: [] };
      if (url === '/api/v1/library/items/item-1/highlights' && method === 'GET')
        return { items: [] };
      if (url === '/api/v1/me/reviews' && method === 'GET') return { items: [] };

      if (url === '/api/v1/works/work-1/editions' && method === 'GET') {
        return {
          items: [
            {
              id: 'edition-2',
              isbn10: null,
              isbn13: '9780000000002',
              publisher: 'Pub',
              publish_date: '2026-02-01',
              cover_url: null,
              created_at: '2026-02-01T00:00:00Z',
              provider: 'openlibrary',
              provider_id: '/books/OL1M',
            },
          ],
        };
      }
      if (url === '/api/v1/editions/edition-2/cover/cache' && method === 'POST') {
        return { cached: true, cover_url: 'https://example.com/cached.jpg' };
      }
      if (url === '/api/v1/library/items/item-1' && method === 'PATCH') {
        expect(opts?.body).toEqual({ preferred_edition_id: 'edition-2' });
        return {
          id: 'item-1',
          work_id: 'work-1',
          preferred_edition_id: 'edition-2',
          status: 'reading',
          created_at: '2026-02-01',
        };
      }

      throw new Error(`unexpected request: ${method} ${url}`);
    });

    const wrapper = mountPage();
    await flushPromises();

    await clickButton(wrapper, 'Set cover');
    await flushPromises();

    // Select the edition via the dialog select, and flip the "preferred" checkbox.
    const dialog = wrapper.get('[data-test="dialog"]');
    await dialog.get('select').setValue('edition-2');
    await dialog.get('#preferred').setValue(false);
    expect((wrapper.vm as any).setPreferredEdition).toBe(false);
    await dialog.get('#preferred').setValue(true);
    expect((wrapper.vm as any).setPreferredEdition).toBe(true);

    (wrapper.vm as any).coverSourceUrl = 'https://covers.openlibrary.org/b/id/1-L.jpg';
    await (wrapper.vm as any).cacheCover();
    await flushPromises();

    expect(apiRequest).toHaveBeenCalledWith('/api/v1/works/work-1/editions');
    expect(apiRequest).toHaveBeenCalledWith(
      '/api/v1/editions/edition-2/cover/cache',
      expect.anything(),
    );
    expect(apiRequest).toHaveBeenCalledWith('/api/v1/library/items/item-1', expect.anything());
  });

  it('builds edition option labels without metadata when isbn/publisher/date are missing', async () => {
    apiRequest.mockImplementation(async (url: string, opts?: any) => {
      const method = (opts?.method || 'GET').toUpperCase();
      if (url === '/api/v1/works/work-1' && method === 'GET') {
        return { id: 'work-1', title: 'Book A', description: null, cover_url: null, authors: [] };
      }
      if (url === '/api/v1/library/items/by-work/work-1' && method === 'GET') {
        return {
          id: 'item-1',
          work_id: 'work-1',
          preferred_edition_id: null,
          status: 'reading',
          created_at: '2026-02-01',
        };
      }
      if (url === '/api/v1/library/items/item-1/sessions' && method === 'GET') return { items: [] };
      if (url === '/api/v1/library/items/item-1/notes' && method === 'GET') return { items: [] };
      if (url === '/api/v1/library/items/item-1/highlights' && method === 'GET')
        return { items: [] };
      if (url === '/api/v1/me/reviews' && method === 'GET') return { items: [] };
      if (url === '/api/v1/works/work-1/editions' && method === 'GET') {
        return {
          items: [
            {
              id: 'edition-blank',
              isbn10: null,
              isbn13: null,
              publisher: null,
              publish_date: null,
              cover_url: null,
              created_at: '2026-02-01T00:00:00Z',
            },
          ],
        };
      }
      throw new Error(`unexpected request: ${method} ${url}`);
    });

    const wrapper = mountPage();
    await flushPromises();

    await clickButton(wrapper, 'Set cover');
    await flushPromises();

    const options = (wrapper.vm as any).editionOptions as Array<{ label: string; value: string }>;
    expect(options).toEqual([{ value: 'edition-blank', label: 'edition-blank' }]);
  });

  it('uses a generic editions load error when openCoverDialog fails with a non-ApiClientError', async () => {
    apiRequest.mockImplementation(async (url: string, opts?: any) => {
      const method = (opts?.method || 'GET').toUpperCase();
      if (url === '/api/v1/works/work-1' && method === 'GET') {
        return { id: 'work-1', title: 'Book A', description: null, cover_url: null, authors: [] };
      }
      if (url === '/api/v1/library/items/by-work/work-1' && method === 'GET') {
        return {
          id: 'item-1',
          work_id: 'work-1',
          preferred_edition_id: null,
          status: 'reading',
          created_at: '2026-02-01',
        };
      }
      if (url === '/api/v1/library/items/item-1/sessions' && method === 'GET') return { items: [] };
      if (url === '/api/v1/library/items/item-1/notes' && method === 'GET') return { items: [] };
      if (url === '/api/v1/library/items/item-1/highlights' && method === 'GET')
        return { items: [] };
      if (url === '/api/v1/me/reviews' && method === 'GET') return { items: [] };
      if (url === '/api/v1/works/work-1/editions' && method === 'GET') {
        throw new Error('boom');
      }
      throw new Error(`unexpected request: ${method} ${url}`);
    });

    const wrapper = mountPage();
    await flushPromises();

    await clickButton(wrapper, 'Set cover');
    await flushPromises();

    expect((wrapper.vm as any).coverError).toContain('Unable to load editions.');
  });

  it('shows a helpful error when cover actions run without a selected edition', async () => {
    apiRequest.mockImplementation(async (url: string, opts?: any) => {
      const method = (opts?.method || 'GET').toUpperCase();
      if (url === '/api/v1/works/work-1' && method === 'GET') {
        return {
          id: 'work-1',
          title: 'Book A',
          description: null,
          cover_url: null,
          authors: [],
        };
      }
      if (url === '/api/v1/library/items/by-work/work-1' && method === 'GET') {
        return {
          id: 'item-1',
          work_id: 'work-1',
          preferred_edition_id: null,
          status: 'reading',
          created_at: '2026-02-01',
        };
      }
      if (url === '/api/v1/library/items/item-1/sessions' && method === 'GET') return { items: [] };
      if (url === '/api/v1/library/items/item-1/notes' && method === 'GET') return { items: [] };
      if (url === '/api/v1/library/items/item-1/highlights' && method === 'GET')
        return { items: [] };
      if (url === '/api/v1/me/reviews' && method === 'GET') return { items: [] };
      if (url === '/api/v1/works/work-1/editions' && method === 'GET') return { items: [] };
      throw new Error(`unexpected request: ${method} ${url}`);
    });

    const wrapper = mountPage();
    await flushPromises();

    await clickButton(wrapper, 'Set cover');
    await flushPromises();

    // No editions means no effective edition id.
    (wrapper.vm as any).coverMode = 'upload';
    (wrapper.vm as any).coverFile = new File(['x'], 'cover.jpg', { type: 'image/jpeg' });
    await (wrapper.vm as any).uploadCover();
    expect((wrapper.vm as any).coverError).toContain('Select an edition first');

    (wrapper.vm as any).coverMode = 'url';
    (wrapper.vm as any).coverSourceUrl = 'https://covers.openlibrary.org/b/id/1-L.jpg';
    await (wrapper.vm as any).cacheCover();
    expect((wrapper.vm as any).coverError).toContain('Select an edition first');
  });

  it('shows editions load error in cover dialog when editions request fails', async () => {
    apiRequest.mockImplementation(async (url: string, opts?: any) => {
      const method = (opts?.method || 'GET').toUpperCase();
      if (url === '/api/v1/works/work-1' && method === 'GET') {
        return {
          id: 'work-1',
          title: 'Book A',
          description: null,
          cover_url: null,
          authors: [],
        };
      }
      if (url === '/api/v1/library/items/by-work/work-1' && method === 'GET') {
        return {
          id: 'item-1',
          work_id: 'work-1',
          preferred_edition_id: null,
          status: 'reading',
          created_at: '2026-02-01',
        };
      }
      if (url === '/api/v1/library/items/item-1/sessions' && method === 'GET') return { items: [] };
      if (url === '/api/v1/library/items/item-1/notes' && method === 'GET') return { items: [] };
      if (url === '/api/v1/library/items/item-1/highlights' && method === 'GET')
        return { items: [] };
      if (url === '/api/v1/me/reviews' && method === 'GET') return { items: [] };
      if (url === '/api/v1/works/work-1/editions' && method === 'GET') {
        throw new ApiClientErrorMock('Boom', 'bad_request', 400);
      }
      throw new Error(`unexpected request: ${method} ${url}`);
    });

    const wrapper = mountPage();
    await flushPromises();

    await clickButton(wrapper, 'Set cover');
    await flushPromises();

    expect((wrapper.vm as any).coverDialogVisible).toBe(true);
    expect((wrapper.vm as any).coverError).toContain('Boom');
  });

  it('covers cover dialog mode switching and guard rails', async () => {
    apiRequest.mockImplementation(async (url: string, opts?: any) => {
      const method = (opts?.method || 'GET').toUpperCase();
      if (url === '/api/v1/works/work-1' && method === 'GET') {
        return {
          id: 'work-1',
          title: 'Book A',
          description: null,
          cover_url: null,
          authors: [],
        };
      }
      if (url === '/api/v1/library/items/by-work/work-1' && method === 'GET') {
        return {
          id: 'item-1',
          work_id: 'work-1',
          preferred_edition_id: 'edition-1',
          status: 'reading',
          created_at: '2026-02-01',
        };
      }
      if (url === '/api/v1/library/items/item-1/sessions' && method === 'GET') return { items: [] };
      if (url === '/api/v1/library/items/item-1/notes' && method === 'GET') return { items: [] };
      if (url === '/api/v1/library/items/item-1/highlights' && method === 'GET')
        return { items: [] };
      if (url === '/api/v1/me/reviews' && method === 'GET') return { items: [] };
      throw new Error(`unexpected request: ${method} ${url}`);
    });

    const wrapper = mountPage();
    await flushPromises();

    await clickButton(wrapper, 'Set cover');
    await flushPromises();

    expect((wrapper.vm as any).coverMode).toBe('upload');
    await clickButton(wrapper, 'Use image URL');
    await flushPromises();
    expect((wrapper.vm as any).coverMode).toBe('url');
    await clickButton(wrapper, 'Upload image');
    await flushPromises();
    expect((wrapper.vm as any).coverMode).toBe('upload');

    // Guard: cacheCover requires a URL.
    (wrapper.vm as any).coverMode = 'url';
    (wrapper.vm as any).coverSourceUrl = '';
    await (wrapper.vm as any).cacheCover();
    expect((wrapper.vm as any).coverError).toContain('Enter an image URL');

    // Guard: uploadCover requires a file.
    (wrapper.vm as any).coverMode = 'upload';
    (wrapper.vm as any).coverFile = null;
    await (wrapper.vm as any).uploadCover();
    expect((wrapper.vm as any).coverError).toContain('Choose an image file');

    // Cover file change handler.
    const file = new File(['x'], 'cover.jpg', { type: 'image/jpeg' });
    await (wrapper.vm as any).onCoverFileSelect({
      originalEvent: new Event('change'),
      files: [file],
    });
    expect((wrapper.vm as any).coverFile).toBeTruthy();

    await (wrapper.vm as any).onCoverFileSelect({ originalEvent: new Event('change'), files: [] });
    expect((wrapper.vm as any).coverFile).toBe(null);

    // Cancel closes the dialog.
    (wrapper.vm as any).coverMode = 'url';
    await clickButton(wrapper, 'Cancel');
    await flushPromises();
    expect((wrapper.vm as any).coverDialogVisible).toBe(false);
  });

  it('surfaces ApiClientError and generic errors for cover actions', async () => {
    apiRequest.mockImplementation(async (url: string, opts?: any) => {
      const method = (opts?.method || 'GET').toUpperCase();
      if (url === '/api/v1/works/work-1' && method === 'GET') {
        return {
          id: 'work-1',
          title: 'Book A',
          description: null,
          cover_url: null,
          authors: [],
        };
      }
      if (url === '/api/v1/library/items/by-work/work-1' && method === 'GET') {
        return {
          id: 'item-1',
          work_id: 'work-1',
          preferred_edition_id: 'edition-1',
          status: 'reading',
          created_at: '2026-02-01',
        };
      }
      if (url === '/api/v1/library/items/item-1/sessions' && method === 'GET') return { items: [] };
      if (url === '/api/v1/library/items/item-1/notes' && method === 'GET') return { items: [] };
      if (url === '/api/v1/library/items/item-1/highlights' && method === 'GET')
        return { items: [] };
      if (url === '/api/v1/me/reviews' && method === 'GET') return { items: [] };

      if (url === '/api/v1/editions/edition-1/cover' && method === 'POST') {
        throw new ApiClientErrorMock('Nope', 'forbidden', 403);
      }
      if (url === '/api/v1/editions/edition-1/cover/cache' && method === 'POST') {
        throw new Error('boom');
      }

      throw new Error(`unexpected request: ${method} ${url}`);
    });

    const wrapper = mountPage();
    await flushPromises();

    await clickButton(wrapper, 'Set cover');
    await flushPromises();

    (wrapper.vm as any).coverFile = new File(['x'], 'cover.jpg', { type: 'image/jpeg' });
    await (wrapper.vm as any).uploadCover();
    expect((wrapper.vm as any).coverError).toContain('Nope');

    (wrapper.vm as any).coverMode = 'url';
    (wrapper.vm as any).coverSourceUrl = 'https://covers.openlibrary.org/b/id/1-L.jpg';
    await (wrapper.vm as any).cacheCover();
    expect((wrapper.vm as any).coverError).toContain('Unable to cache cover');
  });

  it('covers the remaining cover error branches (upload generic error, cache ApiClientError)', async () => {
    apiRequest.mockImplementation(async (url: string, opts?: any) => {
      const method = (opts?.method || 'GET').toUpperCase();
      if (url === '/api/v1/works/work-1' && method === 'GET') {
        return { id: 'work-1', title: 'Book A', description: null, cover_url: null, authors: [] };
      }
      if (url === '/api/v1/library/items/by-work/work-1' && method === 'GET') {
        return {
          id: 'item-1',
          work_id: 'work-1',
          preferred_edition_id: 'edition-1',
          status: 'reading',
          created_at: '2026-02-01',
        };
      }
      if (url === '/api/v1/library/items/item-1/sessions' && method === 'GET') return { items: [] };
      if (url === '/api/v1/library/items/item-1/notes' && method === 'GET') return { items: [] };
      if (url === '/api/v1/library/items/item-1/highlights' && method === 'GET')
        return { items: [] };
      if (url === '/api/v1/me/reviews' && method === 'GET') return { items: [] };

      if (url === '/api/v1/editions/edition-1/cover' && method === 'POST') {
        throw new Error('boom');
      }
      if (url === '/api/v1/editions/edition-1/cover/cache' && method === 'POST') {
        throw new ApiClientErrorMock('Cache denied', 'forbidden', 403);
      }

      throw new Error(`unexpected request: ${method} ${url}`);
    });

    const wrapper = mountPage();
    await flushPromises();

    await clickButton(wrapper, 'Set cover');
    await flushPromises();

    (wrapper.vm as any).coverFile = new File(['x'], 'cover.jpg', { type: 'image/jpeg' });
    await (wrapper.vm as any).uploadCover();
    expect((wrapper.vm as any).coverError).toContain('Unable to set cover');

    (wrapper.vm as any).coverMode = 'url';
    (wrapper.vm as any).coverSourceUrl = 'https://covers.openlibrary.org/b/id/1-L.jpg';
    await (wrapper.vm as any).cacheCover();
    expect((wrapper.vm as any).coverError).toContain('Cache denied');
  });

  it('exercises maybeSetPreferredEdition guard returns', async () => {
    const calls: Array<{ url: string; opts?: any }> = [];
    apiRequest.mockImplementation(async (url: string, opts?: any) => {
      calls.push({ url, opts });
      const method = (opts?.method || 'GET').toUpperCase();
      if (url === '/api/v1/works/work-1' && method === 'GET') {
        return { id: 'work-1', title: 'Book A', description: null, cover_url: null, authors: [] };
      }
      if (url === '/api/v1/library/items/by-work/work-1' && method === 'GET') {
        return {
          id: 'item-1',
          work_id: 'work-1',
          preferred_edition_id: null,
          status: 'reading',
          created_at: '2026-02-01',
        };
      }
      if (url === '/api/v1/library/items/item-1/sessions' && method === 'GET') return { items: [] };
      if (url === '/api/v1/library/items/item-1/notes' && method === 'GET') return { items: [] };
      if (url === '/api/v1/library/items/item-1/highlights' && method === 'GET')
        return { items: [] };
      if (url === '/api/v1/me/reviews' && method === 'GET') return { items: [] };
      throw new Error(`unexpected request: ${method} ${url}`);
    });

    const wrapper = mountPage();
    await flushPromises();

    // No library item.
    (wrapper.vm as any).libraryItem = null;
    await (wrapper.vm as any).maybeSetPreferredEdition();

    // Library item, but user opted out of setting preferred edition.
    (wrapper.vm as any).libraryItem = { id: 'item-1', preferred_edition_id: null };
    (wrapper.vm as any).selectedEditionId = '';
    (wrapper.vm as any).setPreferredEdition = false;
    await (wrapper.vm as any).maybeSetPreferredEdition();

    // Opted in, but no effective edition id.
    (wrapper.vm as any).setPreferredEdition = true;
    (wrapper.vm as any).selectedEditionId = '';
    await (wrapper.vm as any).maybeSetPreferredEdition();

    // Opted in, but already matches preferred edition.
    (wrapper.vm as any).libraryItem = { id: 'item-1', preferred_edition_id: 'edition-1' };
    await (wrapper.vm as any).maybeSetPreferredEdition();

    expect(
      calls.find((c) => c.url === '/api/v1/library/items/item-1' && c.opts?.method === 'PATCH'),
    ).toBeFalsy();
  });

  it('handles highlights with location_sort and sends it when saving', async () => {
    apiRequest.mockImplementation(async (url: string, opts?: any) => {
      const method = (opts?.method || 'GET').toUpperCase();
      if (url === '/api/v1/works/work-1' && method === 'GET') {
        return { id: 'work-1', title: 'Book A', description: null, cover_url: null, authors: [] };
      }
      if (url === '/api/v1/library/items/by-work/work-1' && method === 'GET') {
        return {
          id: 'item-1',
          work_id: 'work-1',
          preferred_edition_id: 'edition-1',
          status: 'reading',
          created_at: '2026-02-01',
        };
      }
      if (url === '/api/v1/library/items/item-1/sessions' && method === 'GET') return { items: [] };
      if (url === '/api/v1/library/items/item-1/notes' && method === 'GET') return { items: [] };
      if (url === '/api/v1/library/items/item-1/highlights' && method === 'GET') {
        return {
          items: [
            {
              id: 'highlight-1',
              quote: 'Quote',
              visibility: 'private',
              created_at: '2026-02-08T00:00:00Z',
              location_sort: 10,
            },
          ],
        };
      }
      if (url === '/api/v1/me/reviews' && method === 'GET') return { items: [] };
      if (url === '/api/v1/highlights/highlight-1' && method === 'PATCH') {
        expect(opts?.body?.location_sort).toBe(12);
        return { id: 'highlight-1' };
      }
      throw new Error(`unexpected request: ${method} ${url}`);
    });

    const wrapper = mountPage();
    await flushPromises();

    await clickButton(wrapper, 'Edit');
    await flushPromises();
    expect((wrapper.vm as any).editHighlightLocationSort).toBe('10');

    await wrapper
      .get('[data-test="dialog"]')
      .find('input[placeholder="Location (optional)"]')
      .setValue('12');
    await wrapper.get('[data-test="dialog"]').find('textarea').setValue('Updated quote');
    await clickButton(wrapper, 'Save');
    await flushPromises();
  });

  it('does nothing when saving an edited highlight without an id', async () => {
    const calls: string[] = [];
    apiRequest.mockImplementation(async (url: string, opts?: any) => {
      calls.push(`${(opts?.method || 'GET').toUpperCase()} ${url}`);
      const method = (opts?.method || 'GET').toUpperCase();

      if (url === '/api/v1/works/work-1' && method === 'GET') {
        return { id: 'work-1', title: 'Book A', description: null, cover_url: null, authors: [] };
      }
      if (url === '/api/v1/library/items/by-work/work-1' && method === 'GET') {
        return {
          id: 'item-1',
          work_id: 'work-1',
          preferred_edition_id: 'edition-1',
          status: 'reading',
          created_at: '2026-02-01',
        };
      }
      if (url === '/api/v1/library/items/item-1/sessions' && method === 'GET') return { items: [] };
      if (url === '/api/v1/library/items/item-1/notes' && method === 'GET') return { items: [] };
      if (url === '/api/v1/library/items/item-1/highlights' && method === 'GET')
        return { items: [] };
      if (url === '/api/v1/me/reviews' && method === 'GET') return { items: [] };

      throw new Error(`unexpected request: ${method} ${url}`);
    });

    const wrapper = mountPage();
    await flushPromises();

    // Ensure the early-return guard (`if (!editHighlightId.value) return;`) is exercised.
    (wrapper.vm as any).editHighlightId = null;
    await (wrapper.vm as any).saveEditHighlight();
    await flushPromises();

    expect(calls.some((c) => c.includes('/api/v1/highlights/'))).toBe(false);
  });

  it('renders cover dialog url mode content and can cancel', async () => {
    apiRequest.mockImplementation(async (url: string, opts?: any) => {
      const method = (opts?.method || 'GET').toUpperCase();
      if (url === '/api/v1/works/work-1' && method === 'GET') {
        return {
          id: 'work-1',
          title: 'Book A',
          description: null,
          cover_url: null,
          authors: [],
        };
      }
      if (url === '/api/v1/library/items/by-work/work-1' && method === 'GET') {
        return {
          id: 'item-1',
          work_id: 'work-1',
          preferred_edition_id: 'edition-1',
          status: 'reading',
          created_at: '2026-02-01',
        };
      }
      if (url === '/api/v1/library/items/item-1/sessions' && method === 'GET') return { items: [] };
      if (url === '/api/v1/library/items/item-1/notes' && method === 'GET') return { items: [] };
      if (url === '/api/v1/library/items/item-1/highlights' && method === 'GET')
        return { items: [] };
      if (url === '/api/v1/me/reviews' && method === 'GET') return { items: [] };
      throw new Error(`unexpected request: ${method} ${url}`);
    });

    const wrapper = mountPage();
    await flushPromises();

    await clickButton(wrapper, 'Set cover');
    await flushPromises();

    await clickButton(wrapper, 'Use image URL');
    await flushPromises();

    expect(wrapper.find('input[placeholder="https://covers.openlibrary.org/..."]').exists()).toBe(
      true,
    );

    // Cover the v-model update handler for coverSourceUrl.
    const urlInput = wrapper.get('input[placeholder="https://covers.openlibrary.org/..."]');
    await urlInput.setValue('https://covers.openlibrary.org/b/id/1-L.jpg');
    await flushPromises();
    expect((wrapper.vm as any).coverSourceUrl).toContain('covers.openlibrary.org');

    await clickButton(wrapper, 'Cancel');
    await flushPromises();

    expect((wrapper.vm as any).coverDialogVisible).toBe(false);
    // Cover the v-model update handler generated for the dialog itself.
    await emitDialogVisible(wrapper, 'Set cover', false);
  });

  it('falls back to the raw value if Date formatting throws', async () => {
    const original = Date.prototype.toLocaleString;
    Date.prototype.toLocaleString = () => {
      throw new Error('boom');
    };

    apiRequest.mockImplementation(async (url: string, opts?: any) => {
      const method = (opts?.method || 'GET').toUpperCase();
      if (url === '/api/v1/works/work-1' && method === 'GET') {
        return {
          id: 'work-1',
          title: 'Book A',
          description: null,
          cover_url: null,
          authors: [],
        };
      }
      if (url === '/api/v1/library/items/by-work/work-1' && method === 'GET') {
        return { id: 'item-1', work_id: 'work-1', status: 'reading', created_at: '2026-02-01' };
      }
      if (url === '/api/v1/library/items/item-1/sessions' && method === 'GET') {
        return {
          items: [
            {
              id: 'session-1',
              started_at: '2026-02-08T00:00:00Z',
              pages_read: null,
              progress_percent: null,
              note: null,
            },
          ],
        };
      }
      if (url === '/api/v1/library/items/item-1/notes' && method === 'GET') return { items: [] };
      if (url === '/api/v1/library/items/item-1/highlights' && method === 'GET')
        return { items: [] };
      if (url === '/api/v1/me/reviews' && method === 'GET') return { items: [] };
      throw new Error(`unexpected request: ${method} ${url}`);
    });

    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.text()).toContain('2026-02-08T00:00:00Z');

    Date.prototype.toLocaleString = original;
  });

  it('surfaces errors when by-work fails with non-404', async () => {
    apiRequest.mockImplementation(async (url: string) => {
      if (url === '/api/v1/works/work-1') {
        return {
          id: 'work-1',
          title: 'Book A',
          description: null,
          cover_url: null,
          authors: [],
        };
      }
      if (url === '/api/v1/library/items/by-work/work-1') {
        throw new ApiClientErrorMock('Nope', 'forbidden', 403);
      }
      throw new Error(`unexpected request: ${url}`);
    });

    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.get('[data-test="book-detail-error"]').text()).toContain('Nope');
  });

  it('shows a helpful message for generic load failures', async () => {
    apiRequest.mockRejectedValueOnce(new Error('boom'));

    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.get('[data-test="book-detail-error"]').text()).toContain(
      'Unable to load book details right now.',
    );
  });

  it('seeds review fields safely when existing review has nulls', async () => {
    apiRequest.mockImplementation(async (url: string, opts?: any) => {
      const method = (opts?.method || 'GET').toUpperCase();
      if (url === '/api/v1/works/work-1' && method === 'GET') {
        return {
          id: 'work-1',
          title: 'Book A',
          description: null,
          cover_url: null,
          authors: [],
        };
      }
      if (url === '/api/v1/library/items/by-work/work-1' && method === 'GET') {
        return { id: 'item-1', work_id: 'work-1', status: 'reading', created_at: '2026-02-01' };
      }
      if (url === '/api/v1/library/items/item-1/sessions' && method === 'GET') return { items: [] };
      if (url === '/api/v1/library/items/item-1/notes' && method === 'GET') return { items: [] };
      if (url === '/api/v1/library/items/item-1/highlights' && method === 'GET')
        return { items: [] };
      if (url === '/api/v1/me/reviews' && method === 'GET') {
        return {
          items: [
            {
              id: 'review-1',
              work_id: 'work-1',
              title: null,
              body: null,
              visibility: 'private',
              rating: null,
            },
          ],
        };
      }
      throw new Error(`unexpected request: ${method} ${url}`);
    });

    const wrapper = mountPage();
    await flushPromises();

    expect((wrapper.vm as any).reviewTitle).toBe('');
    expect((wrapper.vm as any).reviewBody).toBe('');
    expect((wrapper.vm as any).reviewRating).toBe(null);
  });

  it('handles an empty workId route param', async () => {
    state.route.fullPath = '/books/';
    state.route.params.workId = undefined as any;
    apiRequest.mockImplementation(async (url: string) => {
      if (url === '/api/v1/works/') {
        throw new ApiClientErrorMock('Bad route', 'bad_request', 400);
      }
      throw new Error(`unexpected request: ${url}`);
    });

    const wrapper = mountPage();
    await flushPromises();

    expect(apiRequest).toHaveBeenCalledWith('/api/v1/works/');
    expect(wrapper.get('[data-test="book-detail-error"]').text()).toContain('Bad route');
  });

  it('does not refetch notes after saving edits when library item is missing', async () => {
    apiRequest.mockImplementation(async (url: string, opts?: any) => {
      const method = (opts?.method || 'GET').toUpperCase();
      if (url === '/api/v1/works/work-1' && method === 'GET') {
        return {
          id: 'work-1',
          title: 'Book A',
          description: null,
          cover_url: null,
          authors: [],
        };
      }
      if (url === '/api/v1/library/items/by-work/work-1' && method === 'GET') {
        return { id: 'item-1', work_id: 'work-1', status: 'reading', created_at: '2026-02-01' };
      }
      if (url === '/api/v1/library/items/item-1/sessions' && method === 'GET') return { items: [] };
      if (url === '/api/v1/library/items/item-1/notes' && method === 'GET') return { items: [] };
      if (url === '/api/v1/library/items/item-1/highlights' && method === 'GET')
        return { items: [] };
      if (url === '/api/v1/me/reviews' && method === 'GET') return { items: [] };
      if (url === '/api/v1/notes/note-1' && method === 'PATCH') return { id: 'note-1' };
      throw new Error(`unexpected request: ${method} ${url}`);
    });

    const wrapper = mountPage();
    await flushPromises();

    (wrapper.vm as any).libraryItem = null;
    (wrapper.vm as any).editNoteId = 'note-1';
    (wrapper.vm as any).editNoteBody = 'Updated';
    await (wrapper.vm as any).saveEditNote();

    expect(apiRequest).toHaveBeenCalledWith('/api/v1/notes/note-1', expect.anything());
    expect(apiRequest).not.toHaveBeenCalledWith(
      '/api/v1/library/items/item-1/notes',
      expect.anything(),
    );
  });

  it('renders and reports errors from load and actions', async () => {
    const counts = {
      sessionPost: 0,
      notePost: 0,
      notePatch: 0,
      noteDelete: 0,
      highlightPost: 0,
      highlightPatch: 0,
      highlightDelete: 0,
      reviewPost: 0,
    };

    apiRequest.mockImplementation(async (url: string, opts?: any) => {
      const method = (opts?.method || 'GET').toUpperCase();

      if (url === '/api/v1/works/work-1' && method === 'GET') {
        return {
          id: 'work-1',
          title: 'Book A',
          description: null,
          cover_url: null,
          authors: [],
        };
      }
      if (url === '/api/v1/library/items/by-work/work-1' && method === 'GET') {
        return { id: 'item-1', work_id: 'work-1', status: 'reading', created_at: '2026-02-01' };
      }
      if (url === '/api/v1/library/items/item-1/sessions' && method === 'GET') {
        return { items: [] };
      }
      if (url === '/api/v1/library/items/item-1/notes' && method === 'GET') {
        return {
          items: [
            {
              id: 'note-1',
              title: null,
              body: 'Body',
              visibility: 'private',
              created_at: '2026-02-08T00:00:00Z',
            },
          ],
        };
      }
      if (url === '/api/v1/library/items/item-1/highlights' && method === 'GET') {
        return {
          items: [
            {
              id: 'highlight-1',
              quote: 'Quote',
              visibility: 'private',
              created_at: '2026-02-08T00:00:00Z',
            },
          ],
        };
      }
      if (url === '/api/v1/me/reviews' && method === 'GET') {
        return { items: [] };
      }

      if (url === '/api/v1/library/items/item-1/sessions' && method === 'POST') {
        counts.sessionPost += 1;
        if (counts.sessionPost === 1)
          throw new ApiClientErrorMock('Session denied', 'forbidden', 403);
        throw new Error('boom');
      }
      if (url === '/api/v1/library/items/item-1/notes' && method === 'POST') {
        counts.notePost += 1;
        if (counts.notePost === 1) throw new Error('boom');
        throw new ApiClientErrorMock('Note create denied', 'forbidden', 403);
      }
      if (url === '/api/v1/notes/note-1' && method === 'PATCH') {
        counts.notePatch += 1;
        if (counts.notePatch === 1) throw new ApiClientErrorMock('Note denied', 'forbidden', 403);
        throw new Error('boom');
      }
      if (url === '/api/v1/notes/note-1' && method === 'DELETE') {
        counts.noteDelete += 1;
        if (counts.noteDelete === 1) throw new Error('boom');
        throw new ApiClientErrorMock('Note delete denied', 'forbidden', 403);
      }
      if (url === '/api/v1/library/items/item-1/highlights' && method === 'POST') {
        counts.highlightPost += 1;
        if (counts.highlightPost === 1) throw new Error('boom');
        throw new ApiClientErrorMock('Highlight create denied', 'forbidden', 403);
      }
      if (url === '/api/v1/highlights/highlight-1' && method === 'PATCH') {
        counts.highlightPatch += 1;
        if (counts.highlightPatch === 1) throw new Error('boom');
        throw new ApiClientErrorMock('Highlight update denied', 'forbidden', 403);
      }
      if (url === '/api/v1/highlights/highlight-1' && method === 'DELETE') {
        counts.highlightDelete += 1;
        if (counts.highlightDelete === 1)
          throw new ApiClientErrorMock('Highlight denied', 'forbidden', 403);
        throw new Error('boom');
      }
      if (url === '/api/v1/works/work-1/review' && method === 'POST') {
        counts.reviewPost += 1;
        if (counts.reviewPost === 1) throw new Error('boom');
        throw new ApiClientErrorMock('Review denied', 'forbidden', 403);
      }

      throw new Error(`unexpected request: ${method} ${url}`);
    });

    const wrapper = mountPage();
    await flushPromises();

    // Early return guards when there is no library item.
    (wrapper.vm as any).libraryItem = null;
    await (wrapper.vm as any).saveEditNote();
    await (wrapper.vm as any).logSession();
    await (wrapper.vm as any).addNote();
    await (wrapper.vm as any).addHighlight();

    // Now exercise action error paths with a library item present.
    (wrapper.vm as any).libraryItem = { id: 'item-1' };
    (wrapper.vm as any).sessionPagesRead = '1';
    await flushPromises();
    await clickButton(wrapper, 'Log session');
    await flushPromises();
    expect(wrapper.get('[data-test="book-detail-error"]').text()).toContain('Session denied');

    // Same endpoint, generic error branch.
    await clickButton(wrapper, 'Log session');
    await flushPromises();
    expect(wrapper.get('[data-test="book-detail-error"]').text()).toContain(
      'Unable to log session.',
    );

    (wrapper.vm as any).newNoteBody = 'Body';
    await clickButton(wrapper, 'Add note');
    await flushPromises();
    expect(wrapper.get('[data-test="book-detail-error"]').text()).toContain('Unable to add note.');

    // ApiClientError branch for addNote
    await clickButton(wrapper, 'Add note');
    await flushPromises();
    expect(wrapper.get('[data-test="book-detail-error"]').text()).toContain('Note create denied');

    await clickButton(wrapper, 'Edit');
    await flushPromises();
    await clickButton(wrapper, 'Save');
    await flushPromises();
    expect(wrapper.get('[data-test="book-detail-error"]').text()).toContain('Note denied');

    // Generic error branch for saveEditNote
    await clickButton(wrapper, 'Save');
    await flushPromises();
    expect(wrapper.get('[data-test="book-detail-error"]').text()).toContain(
      'Unable to update note.',
    );

    // Close the note dialog so highlight editing uses the correct Save button.
    (wrapper.vm as any).editNoteVisible = false;
    await flushPromises();

    // Note delete error (first Delete)
    await clickButton(wrapper, 'Delete', 0);
    await flushPromises();
    expect(wrapper.get('[data-test="book-detail-error"]').text()).toContain(
      'Unable to delete note.',
    );

    // ApiClientError branch for deleteNote
    await clickButton(wrapper, 'Delete', 0);
    await flushPromises();
    expect(wrapper.get('[data-test="book-detail-error"]').text()).toContain('Note delete denied');

    (wrapper.vm as any).newHighlightQuote = 'Quote';
    await clickButton(wrapper, 'Add highlight');
    await flushPromises();
    expect(wrapper.get('[data-test="book-detail-error"]').text()).toContain(
      'Unable to add highlight.',
    );

    // ApiClientError branch for addHighlight
    await clickButton(wrapper, 'Add highlight');
    await flushPromises();
    expect(wrapper.get('[data-test="book-detail-error"]').text()).toContain(
      'Highlight create denied',
    );

    // Highlight edit errors (generic + ApiClientError)
    await clickButton(wrapper, 'Edit', 1);
    await flushPromises();
    await clickButton(wrapper, 'Save');
    await flushPromises();
    expect(wrapper.get('[data-test="book-detail-error"]').text()).toContain(
      'Unable to update highlight.',
    );

    await clickButton(wrapper, 'Save');
    await flushPromises();
    expect(wrapper.get('[data-test="book-detail-error"]').text()).toContain(
      'Highlight update denied',
    );

    // Highlight delete error (second Delete)
    await clickButton(wrapper, 'Delete', 1);
    await flushPromises();
    expect(wrapper.get('[data-test="book-detail-error"]').text()).toContain('Highlight denied');

    // Generic error branch for deleteHighlight
    await clickButton(wrapper, 'Delete', 1);
    await flushPromises();
    expect(wrapper.get('[data-test="book-detail-error"]').text()).toContain(
      'Unable to delete highlight.',
    );

    await clickButton(wrapper, 'Save review');
    await flushPromises();
    expect(wrapper.get('[data-test="book-detail-error"]').text()).toContain(
      'Unable to save review.',
    );

    // ApiClientError branch for saveReview
    await clickButton(wrapper, 'Save review');
    await flushPromises();
    expect(wrapper.get('[data-test="book-detail-error"]').text()).toContain('Review denied');
  });
});
