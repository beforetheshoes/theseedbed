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
const toastAdd = vi.hoisted(() => vi.fn());
const navigateToMock = vi.hoisted(() => vi.fn());
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
  navigateTo: navigateToMock,
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
            '<div v-if="visible" v-bind="$attrs"><div data-test="dialog"><slot /></div></div><div v-else data-test="dialog-hidden"></div>',
        },
        Button: {
          props: ['label', 'loading'],
          emits: ['click'],
          template:
            '<button v-bind="$attrs" :disabled="loading" @click="$emit(`click`, $event)"><slot :class="`p-button`">{{ label }}</slot></button>',
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
        DatePicker: {
          props: ['modelValue', 'maxDate'],
          emits: ['update:modelValue'],
          template:
            '<input type="date" :value="modelValue ? new Date(modelValue).toISOString().slice(0,10) : ``" @input="$emit(`update:modelValue`, new Date(`${$event.target.value}T00:00:00`))" />',
        },
        Slider: {
          props: ['modelValue', 'min', 'max', 'step', 'disabled'],
          emits: ['update:modelValue'],
          template:
            '<input type="range" :min="min ?? 0" :max="max ?? 100" :step="step ?? 1" :disabled="disabled" :value="modelValue" @input="$emit(`update:modelValue`, Number($event.target.value))" />',
        },
        InputNumber: {
          props: ['modelValue', 'min', 'max'],
          emits: ['update:modelValue'],
          template:
            '<input type="number" :min="min" :max="max" :value="modelValue" v-bind="$attrs" @input="$emit(`update:modelValue`, Number($event.target.value))" />',
        },
        Knob: {
          props: ['modelValue'],
          template: '<div data-test="knob-stub">{{ modelValue }}</div>',
        },
        Chart: {
          props: ['type', 'data', 'options'],
          template: '<div data-test="chart-stub"></div>',
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
    toastAdd.mockReset();
    navigateToMock.mockReset();
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

  it('renders description safely when provider text contains html tags', async () => {
    apiRequest.mockImplementation(async (url: string) => {
      if (url === '/api/v1/works/work-1') {
        return {
          id: 'work-1',
          title: 'Book A',
          description: '<b>Bold quote</b><br><i>Line 2</i><script>alert(1)</script>',
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

    const description = wrapper.get('[data-test="book-detail-description"]');
    expect(description.text()).toContain('Bold quote');
    expect(description.text()).toContain('Line 2');
    expect(description.find('b, strong').exists()).toBe(true);
    expect(description.find('i, em').exists()).toBe(true);
    expect(description.find('script').exists()).toBe(false);
  });

  it('renders identifier metadata when present', async () => {
    apiRequest.mockImplementation(async (url: string) => {
      if (url === '/api/v1/works/work-1') {
        return {
          id: 'work-1',
          title: 'Book A',
          description: null,
          cover_url: null,
          authors: [{ id: 'a-1', name: 'Author A' }],
          identifiers: {
            isbn10: '0123456789',
            isbn13: '9780123456789',
            asin: 'B00TESTASIN',
          },
        };
      }
      if (url === '/api/v1/library/items/by-work/work-1') {
        throw new ApiClientErrorMock('Not found', 'not_found', 404);
      }
      throw new Error(`unexpected request: ${url}`);
    });

    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.text()).toContain('Identifiers:');
    expect(wrapper.text()).toContain('ISBN-10 0123456789');
    expect(wrapper.text()).toContain('ISBN-13 9780123456789');
    expect(wrapper.text()).toContain('ASIN B00TESTASIN');
  });

  it('allows changing library status from the book detail header', async () => {
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
      if (url === '/api/v1/library/items/item-1/read-cycles' && method === 'GET')
        return { items: [] };
      if (url === '/api/v1/library/items/item-1/notes' && method === 'GET') return { items: [] };
      if (url === '/api/v1/library/items/item-1/highlights' && method === 'GET')
        return { items: [] };
      if (url === '/api/v1/me/reviews' && method === 'GET') return { items: [] };

      if (url === '/api/v1/library/items/item-1' && method === 'PATCH') {
        return { id: 'item-1', status: opts?.body?.status };
      }

      throw new Error(`unexpected request: ${method} ${url}`);
    });

    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.get('[data-test="book-status-open"]').text()).toContain('Reading');
    await wrapper.get('[data-test="book-status-open"]').trigger('click');
    await wrapper.get('[data-test="book-status-select"]').setValue('completed');
    await flushPromises();

    expect(apiRequest).toHaveBeenCalledWith('/api/v1/library/items/item-1', {
      method: 'PATCH',
      body: { status: 'completed' },
    });
    expect(wrapper.get('[data-test="book-status-open"]').text()).toContain('Completed');
  });

  it('applies cycle conversion totals when loading sessions', async () => {
    apiRequest.mockImplementation(async (url: string, opts?: any) => {
      const method = (opts?.method || 'GET').toUpperCase();
      if (url === '/api/v1/works/work-1' && method === 'GET') {
        return {
          id: 'work-1',
          title: 'Book A',
          description: null,
          cover_url: null,
          total_pages: null,
          total_audio_minutes: null,
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
      if (url === '/api/v1/me' && method === 'GET') return { default_progress_unit: 'pages_read' };
      if (url === '/api/v1/library/items/item-1/read-cycles' && method === 'GET') {
        return {
          items: [
            {
              id: 'cycle-1',
              started_at: '2026-02-08T00:00:00Z',
              conversion: { total_pages: 555, total_audio_minutes: 777 },
            },
          ],
        };
      }
      if (url === '/api/v1/read-cycles/cycle-1/progress-logs' && method === 'GET') {
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

    expect((wrapper.vm as any).work.total_pages).toBe(555);
    expect((wrapper.vm as any).work.total_audio_minutes).toBe(777);
  });

  it('shows generic error when status update fails with non-api error', async () => {
    apiRequest.mockImplementation(async (url: string, opts?: any) => {
      const method = (opts?.method || 'GET').toUpperCase();
      if (url === '/api/v1/works/work-1' && method === 'GET') {
        return {
          id: 'work-1',
          title: 'Book A',
          description: null,
          cover_url: null,
          total_pages: 300,
          total_audio_minutes: 600,
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
      if (url === '/api/v1/me' && method === 'GET') return { default_progress_unit: 'pages_read' };
      if (url === '/api/v1/library/items/item-1/read-cycles' && method === 'GET') {
        return { items: [{ id: 'cycle-1', started_at: '2026-02-08T00:00:00Z' }] };
      }
      if (url === '/api/v1/read-cycles/cycle-1/progress-logs' && method === 'GET') {
        return { items: [] };
      }
      if (url === '/api/v1/library/items/item-1/notes' && method === 'GET') return { items: [] };
      if (url === '/api/v1/library/items/item-1/highlights' && method === 'GET')
        return { items: [] };
      if (url === '/api/v1/me/reviews' && method === 'GET') return { items: [] };
      if (url === '/api/v1/library/items/item-1' && method === 'PATCH') {
        throw new Error('boom');
      }
      throw new Error(`unexpected request: ${method} ${url}`);
    });

    const wrapper = mountPage();
    await flushPromises();
    await wrapper.get('[data-test="book-status-open"]').trigger('click');
    await wrapper.get('[data-test="book-status-select"]').setValue('completed');
    await flushPromises();

    expect(wrapper.get('[data-test="book-detail-error"]').text()).toContain(
      'Unable to update status.',
    );
  });

  it('removes a library item after confirmation and redirects back to the library', async () => {
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

      if (url === '/api/v1/library/items/item-1' && method === 'DELETE') {
        return { deleted: true };
      }

      if (url === '/api/v1/library/items/item-1/sessions' && method === 'GET') {
        return { items: [] };
      }
      if (url === '/api/v1/library/items/item-1/notes' && method === 'GET') {
        return { items: [] };
      }
      if (url === '/api/v1/library/items/item-1/highlights' && method === 'GET') {
        return { items: [] };
      }
      if (url === '/api/v1/me/reviews' && method === 'GET') {
        return { items: [] };
      }

      throw new Error(`unexpected request: ${method} ${url}`);
    });

    const wrapper = mountPage();
    await flushPromises();

    await wrapper.get('[data-test="book-remove-open"]').trigger('click');
    expect(wrapper.find('[data-test="book-remove-dialog"]').exists()).toBe(true);

    await wrapper.get('[data-test="book-remove-confirm"]').trigger('click');
    await flushPromises();

    expect(apiRequest).toHaveBeenCalledWith('/api/v1/library/items/item-1', { method: 'DELETE' });
    expect(toastAdd).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'success', summary: 'Removed from your library.' }),
    );
    expect(navigateToMock).toHaveBeenCalledWith('/library');
  });

  it('handles 404 already-removed delete by toasting and redirecting', async () => {
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

      if (url === '/api/v1/library/items/item-1' && method === 'DELETE') {
        throw new ApiClientErrorMock('Not found', 'not_found', 404);
      }

      if (url === '/api/v1/library/items/item-1/sessions' && method === 'GET') {
        return { items: [] };
      }
      if (url === '/api/v1/library/items/item-1/notes' && method === 'GET') {
        return { items: [] };
      }
      if (url === '/api/v1/library/items/item-1/highlights' && method === 'GET') {
        return { items: [] };
      }
      if (url === '/api/v1/me/reviews' && method === 'GET') {
        return { items: [] };
      }

      throw new Error(`unexpected request: ${method} ${url}`);
    });

    const wrapper = mountPage();
    await flushPromises();

    await wrapper.get('[data-test="book-remove-open"]').trigger('click');
    await wrapper.get('[data-test="book-remove-confirm"]').trigger('click');
    await flushPromises();

    expect(toastAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'info',
        summary: 'This item was already removed. Refreshing...',
      }),
    );
    expect(navigateToMock).toHaveBeenCalledWith('/library');
  });

  it('surfaces non-404 remove errors without closing the dialog', async () => {
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

      if (url === '/api/v1/library/items/item-1' && method === 'DELETE') {
        throw new ApiClientErrorMock('Server error', 'server_error', 500);
      }

      if (url === '/api/v1/library/items/item-1/sessions' && method === 'GET') {
        return { items: [] };
      }
      if (url === '/api/v1/library/items/item-1/notes' && method === 'GET') {
        return { items: [] };
      }
      if (url === '/api/v1/library/items/item-1/highlights' && method === 'GET') {
        return { items: [] };
      }
      if (url === '/api/v1/me/reviews' && method === 'GET') {
        return { items: [] };
      }

      throw new Error(`unexpected request: ${method} ${url}`);
    });

    const wrapper = mountPage();
    await flushPromises();

    await wrapper.get('[data-test="book-remove-open"]').trigger('click');
    await wrapper.get('[data-test="book-remove-confirm"]').trigger('click');
    await flushPromises();

    expect(wrapper.find('[data-test="book-remove-dialog"]').exists()).toBe(true);
    expect(wrapper.get('[data-test="book-detail-error"]').text()).toContain('Server error');
    expect(toastAdd).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'error', summary: 'Server error' }),
    );
    expect(navigateToMock).not.toHaveBeenCalled();
  });

  it('closes the remove dialog on cancel unless loading (covers cancel branches and empty-title branch)', async () => {
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

      if (url === '/api/v1/library/items/item-1/sessions' && method === 'GET') {
        return { items: [] };
      }
      if (url === '/api/v1/library/items/item-1/notes' && method === 'GET') {
        return { items: [] };
      }
      if (url === '/api/v1/library/items/item-1/highlights' && method === 'GET') {
        return { items: [] };
      }
      if (url === '/api/v1/me/reviews' && method === 'GET') {
        return { items: [] };
      }

      throw new Error(`unexpected request: ${method} ${url}`);
    });

    const wrapper = mountPage();
    await flushPromises();

    await wrapper.get('[data-test="book-remove-open"]').trigger('click');
    (wrapper.vm as any).work = null;
    await flushPromises();
    const findRemoveDialog = () => {
      const dialogs = wrapper.findAllComponents({ name: 'Dialog' });
      const match = dialogs.find((d: any) => d.props?.('header') === 'Remove from library');
      expect(match).toBeTruthy();
      return match!;
    };
    expect(findRemoveDialog().find('[data-test="dialog"]').text()).toContain('Remove ""');

    (wrapper.vm as any).removeConfirmLoading = true;
    await flushPromises();
    (wrapper.vm as any).cancelRemoveConfirm();
    await flushPromises();
    expect(findRemoveDialog().props('visible')).toBe(true);
    expect(findRemoveDialog().find('[data-test="dialog"]').exists()).toBe(true);

    (wrapper.vm as any).removeConfirmLoading = false;
    await flushPromises();
    expect((wrapper.vm as any).removeConfirmLoading).toBe(false);
    (wrapper.vm as any).cancelRemoveConfirm();
    await flushPromises();
    expect((wrapper.vm as any).removeConfirmOpen).toBe(false);
    expect(findRemoveDialog().props('visible')).toBe(false);
    expect(findRemoveDialog().find('[data-test="dialog"]').exists()).toBe(false);
  });

  it('loads details and supports CRUD flows (happy path)', async () => {
    const progressLogs: any[] = [];
    const notes: any[] = [];
    const highlights: any[] = [];
    const cycle = { id: 'cycle-1', started_at: '2026-02-08T00:00:00Z' };
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
          total_pages: 300,
          total_audio_minutes: 600,
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

      if (url === '/api/v1/library/items/item-1/read-cycles' && method === 'GET') {
        return { items: [cycle] };
      }
      if (url === '/api/v1/read-cycles/cycle-1/progress-logs' && method === 'GET') {
        return { items: [...progressLogs] };
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

      if (url === '/api/v1/read-cycles/cycle-1/progress-logs' && method === 'POST') {
        progressLogs.unshift({
          id: 'session-1',
          logged_at: opts?.body?.logged_at,
          unit: opts?.body?.unit,
          value: opts?.body?.value,
          canonical_percent: 25,
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
    await wrapper.get('[data-test="knob-value-display"]').trigger('click');
    await wrapper.get('[data-test="knob-value-input"]').setValue('12');
    await wrapper.get('[data-test="knob-value-input"]').trigger('blur');
    await wrapper.find('textarea[placeholder="Session note"]').setValue('Felt great');
    await clickButton(wrapper, 'Log session');
    await flushPromises();
    expect(wrapper.text()).toContain('Start: 0');
    expect(wrapper.text()).toContain('End: 12');
    expect(wrapper.text()).toContain('This session: +12');
    expect(wrapper.text()).toContain('Felt great');

    // Switch to percent and verify deterministic conversion from previous pages value.
    await wrapper.get('[data-test="convert-unit-open"]').trigger('click');
    await wrapper.get('[data-test="convert-unit-select"]').setValue('percent_complete');
    await flushPromises();
    expect((wrapper.vm as any).sessionProgressValue).toBe(4);
    await wrapper.get('[data-test="knob-value-display"]').trigger('click');
    await wrapper.get('[data-test="knob-value-input"]').setValue('25');
    await wrapper.get('[data-test="knob-value-input"]').trigger('blur');
    await clickButton(wrapper, 'Log session');
    await flushPromises();
    expect(wrapper.text()).toContain('Start:');
    expect(wrapper.text()).toContain('End:');
    expect(wrapper.text()).toContain('This session:');

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
    await emitDialogVisible(wrapper, 'Edit note', false);
    expect((wrapper.vm as any).editNoteVisible).toBe(false);

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
    // Set review visibility and rating via Rating stub
    const visibilitySelects = wrapper.findAll('select');
    await visibilitySelects[visibilitySelects.length - 1].setValue('public');

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
    let resolveLogs: any = null;
    const logsPromise = new Promise((resolve) => {
      resolveLogs = resolve;
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
      if (url === '/api/v1/library/items/item-1/read-cycles' && method === 'GET') {
        return { items: [{ id: 'cycle-1', started_at: '2026-02-08T00:00:00Z' }] };
      }
      if (url === '/api/v1/read-cycles/cycle-1/progress-logs' && method === 'GET') {
        return logsPromise as any;
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

    resolveLogs?.({ items: [] });
    await flushPromises();
    expect(wrapper.text()).toContain('No sessions yet.');
  });

  it('prompts for missing totals, persists them, and retries unit conversion', async () => {
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
          total_pages: null,
          total_audio_minutes: null,
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
      if (url === '/api/v1/me' && method === 'GET') {
        return { default_progress_unit: 'pages_read' };
      }
      if (url === '/api/v1/library/items/item-1/read-cycles' && method === 'GET') {
        return { items: [{ id: 'cycle-1', started_at: '2026-02-08T00:00:00Z' }] };
      }
      if (url === '/api/v1/read-cycles/cycle-1/progress-logs' && method === 'GET') {
        return {
          items: [
            {
              id: 'log-1',
              logged_at: '2026-02-07T12:00:00Z',
              unit: 'pages_read',
              value: 20,
              canonical_percent: null,
              note: null,
            },
          ],
        };
      }
      if (url === '/api/v1/library/items/item-1/notes' && method === 'GET') return { items: [] };
      if (url === '/api/v1/library/items/item-1/highlights' && method === 'GET')
        return { items: [] };
      if (url === '/api/v1/me/reviews' && method === 'GET') return { items: [] };
      if (url === '/api/v1/works/work-1/enrichment/candidates' && method === 'GET') {
        return {
          fields: [
            {
              field_key: 'edition.total_pages',
              candidates: [{ value: 320 }],
            },
            {
              field_key: 'edition.total_audio_minutes',
              candidates: [{ value: 600 }],
            },
          ],
        };
      }
      if (url === '/api/v1/works/work-1/editions' && method === 'GET') {
        return { items: [{ id: 'edition-2' }] };
      }
      if (url === '/api/v1/editions/edition-2/totals' && method === 'PATCH') {
        return { total_pages: 200, total_audio_minutes: 600 };
      }

      throw new Error(`unexpected request: ${method} ${url}`);
    });

    const wrapper = mountPage();
    await flushPromises();

    await wrapper.get('[data-test="convert-unit-open"]').trigger('click');
    await wrapper.get('[data-test="convert-unit-select"]').setValue('minutes_listened');
    await flushPromises();

    expect(wrapper.get('[data-test="missing-totals-dialog-content"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('Suggestion: 320 pages');
    expect(wrapper.text()).toContain('Suggestion: 10:00:00');
    expect((wrapper.vm as any).sessionProgressUnit).toBe('percent_complete');

    await wrapper.get('[data-test="pending-total-pages"]').setValue('200');
    await wrapper.get('[data-test="pending-total-audio-minutes"]').setValue('10:00:00');
    await wrapper.get('[data-test="save-missing-totals"]').trigger('click');
    await flushPromises();

    expect((wrapper.vm as any).sessionProgressUnit).toBe('minutes_listened');
    expect((wrapper.vm as any).sessionProgressValue).toBeGreaterThanOrEqual(0);
    expect(calls.some((call) => call.url === '/api/v1/works/work-1/editions')).toBe(true);
    expect(calls.some((call) => call.url === '/api/v1/editions/edition-2/totals')).toBe(true);
  });

  it('sorts timeline logs by day then progress descending and renders date-only labels', async () => {
    apiRequest.mockImplementation(async (url: string, opts?: any) => {
      const method = (opts?.method || 'GET').toUpperCase();
      if (url === '/api/v1/works/work-1' && method === 'GET') {
        return {
          id: 'work-1',
          title: 'Book A',
          description: null,
          cover_url: null,
          total_pages: 300,
          total_audio_minutes: 600,
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
      if (url === '/api/v1/me' && method === 'GET') {
        return { default_progress_unit: 'pages_read' };
      }
      if (url === '/api/v1/library/items/item-1/read-cycles' && method === 'GET') {
        return { items: [{ id: 'cycle-1', started_at: '2026-02-08T00:00:00Z' }] };
      }
      if (url === '/api/v1/read-cycles/cycle-1/progress-logs' && method === 'GET') {
        return {
          items: [
            {
              id: 'log-1',
              logged_at: '2026-02-08T08:00:00Z',
              unit: 'percent_complete',
              value: 45,
              canonical_percent: 45,
              note: null,
            },
            {
              id: 'log-2',
              logged_at: '2026-02-08T09:00:00Z',
              unit: 'percent_complete',
              value: 55,
              canonical_percent: 55,
              note: null,
            },
            {
              id: 'log-3',
              logged_at: '2026-02-07T12:00:00Z',
              unit: 'percent_complete',
              value: 20,
              canonical_percent: 20,
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

    expect((wrapper.vm as any).timelineSessions.map((entry: any) => entry.id)).toEqual([
      'log-2',
      'log-1',
      'log-3',
    ]);
    expect(wrapper.text()).not.toContain('8:00:00');
    expect(wrapper.text()).not.toContain('9:00:00');
  });

  it('uses statistics endpoint for streak, chart, and timeline values', async () => {
    apiRequest.mockImplementation(async (url: string, opts?: any) => {
      const method = (opts?.method || 'GET').toUpperCase();
      if (url === '/api/v1/works/work-1' && method === 'GET') {
        return {
          id: 'work-1',
          title: 'Book A',
          description: null,
          cover_url: null,
          total_pages: 300,
          total_audio_minutes: 600,
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
      if (url === '/api/v1/me' && method === 'GET') {
        return { default_progress_unit: 'pages_read' };
      }
      if (url === '/api/v1/library/items/item-1/read-cycles' && method === 'GET') {
        return { items: [{ id: 'cycle-1', started_at: '2026-02-08T00:00:00Z' }] };
      }
      if (url === '/api/v1/read-cycles/cycle-1/progress-logs' && method === 'GET') {
        return { items: [] };
      }
      if (url === '/api/v1/library/items/item-1/statistics' && method === 'GET') {
        return {
          library_item_id: 'item-1',
          window: { days: 90, tz: 'UTC', start_date: '2026-01-01', end_date: '2026-02-10' },
          totals: { total_pages: 300, total_audio_minutes: 600 },
          counts: {
            total_cycles: 1,
            completed_cycles: 1,
            imported_cycles: 0,
            completed_reads: 1,
            total_logs: 2,
            logs_with_canonical: 2,
            logs_missing_canonical: 0,
          },
          current: {
            latest_logged_at: '2026-02-10T12:00:00Z',
            canonical_percent: 40,
            pages_read: 120,
            minutes_listened: 240,
          },
          streak: { non_zero_days: 3, last_non_zero_date: '2026-02-10' },
          series: {
            progress_over_time: [
              {
                date: '2026-02-08',
                canonical_percent: 20,
                pages_read: 60,
                minutes_listened: 120,
              },
              {
                date: '2026-02-10',
                canonical_percent: 40,
                pages_read: 120,
                minutes_listened: 240,
              },
            ],
            daily_delta: [
              {
                date: '2026-02-08',
                canonical_percent_delta: 20,
                pages_read_delta: 60,
                minutes_listened_delta: 120,
              },
              {
                date: '2026-02-10',
                canonical_percent_delta: 20,
                pages_read_delta: 60,
                minutes_listened_delta: 120,
              },
            ],
          },
          timeline: [
            {
              log_id: 'log-2',
              logged_at: '2026-02-10T12:00:00Z',
              date: '2026-02-10',
              unit: 'percent_complete',
              value: 40,
              note: null,
              start_value: 20,
              end_value: 40,
              session_delta: 20,
            },
          ],
          data_quality: {
            has_missing_totals: false,
            unresolved_logs_exist: false,
            unresolved_log_ids: [],
          },
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

    expect(wrapper.text()).toContain('3-day streak');
    expect((wrapper.vm as any).timelineSessions[0].id).toBe('log-2');
    expect((wrapper.vm as any).progressChartData.labels).toEqual(['2026-02-08', '2026-02-10']);
  });

  it('reloads statistics after logging a session', async () => {
    const statsCalls: string[] = [];
    apiRequest.mockImplementation(async (url: string, opts?: any) => {
      const method = (opts?.method || 'GET').toUpperCase();
      if (url === '/api/v1/works/work-1' && method === 'GET') {
        return {
          id: 'work-1',
          title: 'Book A',
          description: null,
          cover_url: null,
          total_pages: 300,
          total_audio_minutes: 500,
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
      if (url === '/api/v1/me' && method === 'GET') {
        return { default_progress_unit: 'pages_read' };
      }
      if (url === '/api/v1/library/items/item-1/read-cycles' && method === 'GET') {
        return { items: [{ id: 'cycle-1', started_at: '2026-02-08T00:00:00Z' }] };
      }
      if (url === '/api/v1/read-cycles/cycle-1/progress-logs' && method === 'GET') {
        return { items: [] };
      }
      if (url === '/api/v1/library/items/item-1/statistics' && method === 'GET') {
        statsCalls.push(url);
        return {
          library_item_id: 'item-1',
          window: { days: 90, tz: 'UTC', start_date: '2026-01-01', end_date: '2026-02-10' },
          totals: { total_pages: 300, total_audio_minutes: 500 },
          counts: {
            total_cycles: 1,
            completed_cycles: 0,
            imported_cycles: 0,
            completed_reads: 0,
            total_logs: 0,
            logs_with_canonical: 0,
            logs_missing_canonical: 0,
          },
          current: {
            latest_logged_at: null,
            canonical_percent: 0,
            pages_read: 0,
            minutes_listened: 0,
          },
          streak: { non_zero_days: 0, last_non_zero_date: null },
          series: { progress_over_time: [], daily_delta: [] },
          timeline: [],
          data_quality: {
            has_missing_totals: false,
            unresolved_logs_exist: false,
            unresolved_log_ids: [],
          },
        };
      }
      if (url === '/api/v1/read-cycles/cycle-1/progress-logs' && method === 'POST') {
        return { id: 'log-1' };
      }
      if (url === '/api/v1/library/items/item-1/notes' && method === 'GET') return { items: [] };
      if (url === '/api/v1/library/items/item-1/highlights' && method === 'GET')
        return { items: [] };
      if (url === '/api/v1/me/reviews' && method === 'GET') return { items: [] };
      throw new Error(`unexpected request: ${method} ${url}`);
    });

    const wrapper = mountPage();
    await flushPromises();

    await wrapper.get('[data-test="knob-value-display"]').trigger('click');
    await wrapper.get('[data-test="knob-value-input"]').setValue('12');
    await wrapper.get('[data-test="knob-value-input"]').trigger('blur');
    await clickButton(wrapper, 'Log session');
    await flushPromises();

    expect(statsCalls.length).toBeGreaterThanOrEqual(2);
  });

  it('falls back to raw date text when locale formatting throws', async () => {
    const localeSpy = vi.spyOn(Date.prototype, 'toLocaleString').mockImplementation(() => {
      throw new Error('locale unavailable');
    });

    apiRequest.mockImplementation(async (url: string, opts?: any) => {
      const method = (opts?.method || 'GET').toUpperCase();
      if (url === '/api/v1/works/work-1' && method === 'GET') {
        return {
          id: 'work-1',
          title: 'Book A',
          description: null,
          cover_url: null,
          total_pages: 200,
          total_audio_minutes: 300,
          authors: [],
        };
      }
      if (url === '/api/v1/library/items/by-work/work-1' && method === 'GET') {
        return {
          id: 'item-1',
          work_id: 'work-1',
          preferred_edition_id: null,
          status: 'reading',
          created_at: '2026-02-01T00:00:00Z',
        };
      }
      if (url === '/api/v1/me' && method === 'GET') return { default_progress_unit: 'pages_read' };
      if (url === '/api/v1/library/items/item-1/read-cycles' && method === 'GET')
        return { items: [] };
      if (url === '/api/v1/library/items/item-1/statistics' && method === 'GET') {
        return {
          library_item_id: 'item-1',
          window: { days: 90, tz: 'UTC', start_date: '2026-01-01', end_date: '2026-02-10' },
          totals: { total_pages: 200, total_audio_minutes: 300 },
          counts: {
            total_cycles: 0,
            completed_cycles: 0,
            imported_cycles: 0,
            completed_reads: 0,
            total_logs: 0,
            logs_with_canonical: 0,
            logs_missing_canonical: 0,
          },
          current: {
            latest_logged_at: null,
            canonical_percent: 0,
            pages_read: 0,
            minutes_listened: 0,
          },
          streak: { non_zero_days: 0, last_non_zero_date: null },
          series: { progress_over_time: [], daily_delta: [] },
          timeline: [],
          data_quality: {
            has_missing_totals: false,
            unresolved_logs_exist: false,
            unresolved_log_ids: [],
          },
        };
      }
      if (url === '/api/v1/library/items/item-1/notes' && method === 'GET') {
        return {
          items: [
            {
              id: 'note-1',
              title: 'n',
              body: 'body',
              visibility: 'private',
              created_at: '2026-02-08T08:00:00Z',
            },
          ],
        };
      }
      if (url === '/api/v1/library/items/item-1/highlights' && method === 'GET')
        return { items: [] };
      if (url === '/api/v1/me/reviews' && method === 'GET') return { items: [] };
      throw new Error(`unexpected request: ${method} ${url}`);
    });

    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.text()).toContain('2026-02-08T08:00:00Z');
    localeSpy.mockRestore();
  });

  it('falls back to UTC timezone for statistics when Intl timezone detection throws', async () => {
    const original = Intl.DateTimeFormat;
    (Intl as any).DateTimeFormat = () => {
      throw new Error('Intl unavailable');
    };

    const statsQueries: any[] = [];
    apiRequest.mockImplementation(async (url: string, opts?: any) => {
      const method = (opts?.method || 'GET').toUpperCase();
      if (url === '/api/v1/works/work-1' && method === 'GET') {
        return {
          id: 'work-1',
          title: 'Book A',
          description: null,
          cover_url: null,
          total_pages: 200,
          total_audio_minutes: 300,
          authors: [],
        };
      }
      if (url === '/api/v1/library/items/by-work/work-1' && method === 'GET') {
        return {
          id: 'item-1',
          work_id: 'work-1',
          preferred_edition_id: null,
          status: 'reading',
          created_at: '2026-02-01T00:00:00Z',
        };
      }
      if (url === '/api/v1/me' && method === 'GET') return { default_progress_unit: 'pages_read' };
      if (url === '/api/v1/library/items/item-1/read-cycles' && method === 'GET')
        return { items: [] };
      if (url === '/api/v1/library/items/item-1/statistics' && method === 'GET') {
        statsQueries.push(opts?.query);
        return {
          library_item_id: 'item-1',
          window: { days: 90, tz: 'UTC', start_date: '2026-01-01', end_date: '2026-02-10' },
          totals: { total_pages: 200, total_audio_minutes: 300 },
          counts: {
            total_cycles: 0,
            completed_cycles: 0,
            imported_cycles: 0,
            completed_reads: 0,
            total_logs: 0,
            logs_with_canonical: 0,
            logs_missing_canonical: 0,
          },
          current: {
            latest_logged_at: null,
            canonical_percent: 0,
            pages_read: 0,
            minutes_listened: 0,
          },
          streak: { non_zero_days: 0, last_non_zero_date: null },
          series: { progress_over_time: [], daily_delta: [] },
          timeline: [],
          data_quality: {
            has_missing_totals: false,
            unresolved_logs_exist: false,
            unresolved_log_ids: [],
          },
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
    expect(wrapper.exists()).toBe(true);
    expect(statsQueries.some((query) => query?.tz === 'UTC')).toBe(true);

    (Intl as any).DateTimeFormat = original;
  });

  it('creates a read cycle before logging when none exists', async () => {
    const calls: Array<{ url: string; opts?: any }> = [];
    let hasCycle = false;
    apiRequest.mockImplementation(async (url: string, opts?: any) => {
      calls.push({ url, opts });
      const method = (opts?.method || 'GET').toUpperCase();

      if (url === '/api/v1/works/work-1' && method === 'GET') {
        return {
          id: 'work-1',
          title: 'Book A',
          description: null,
          cover_url: null,
          total_pages: 300,
          total_audio_minutes: 500,
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
      if (url === '/api/v1/me' && method === 'GET') {
        return { default_progress_unit: 'pages_read' };
      }
      if (url === '/api/v1/library/items/item-1/read-cycles' && method === 'GET') {
        return hasCycle
          ? { items: [{ id: 'cycle-new', started_at: '2026-02-08T00:00:00Z' }] }
          : { items: [] };
      }
      if (url === '/api/v1/library/items/item-1/read-cycles' && method === 'POST') {
        hasCycle = true;
        return { id: 'cycle-new' };
      }
      if (url === '/api/v1/read-cycles/cycle-new/progress-logs' && method === 'POST') {
        return { id: 'log-1' };
      }
      if (url === '/api/v1/read-cycles/cycle-new/progress-logs' && method === 'GET') {
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

    await wrapper.get('[data-test="knob-value-display"]').trigger('click');
    await wrapper.get('[data-test="knob-value-input"]').setValue('12');
    await wrapper.get('[data-test="knob-value-input"]').trigger('blur');
    await clickButton(wrapper, 'Log session');
    await flushPromises();

    expect(calls.some((call) => call.url === '/api/v1/library/items/item-1/read-cycles')).toBe(
      true,
    );
    expect(
      calls.some(
        (call) =>
          call.url === '/api/v1/library/items/item-1/read-cycles' &&
          (call.opts?.method || '').toUpperCase() === 'POST',
      ),
    ).toBe(true);
    expect(calls.some((call) => call.url === '/api/v1/read-cycles/cycle-new/progress-logs')).toBe(
      true,
    );
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

      if (url === '/api/v1/library/items/item-1/read-cycles' && method === 'GET') {
        if ((counts[url] || 0) === 1) throw new Error('boom');
        return { items: [{ id: 'cycle-1', started_at: '2026-02-08T00:00:00Z' }] };
      }
      if (url === '/api/v1/read-cycles/cycle-1/progress-logs' && method === 'GET') {
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

    expect(counts['/api/v1/library/items/item-1/read-cycles']).toBe(1);
    expect(counts['/api/v1/library/items/item-1/notes']).toBe(1);
    expect(counts['/api/v1/library/items/item-1/highlights']).toBe(1);
    expect(counts['/api/v1/me/reviews']).toBe(1);

    await wrapper.get('[data-test="sessions-retry"]').trigger('click');
    await flushPromises();

    expect(counts['/api/v1/library/items/item-1/read-cycles']).toBe(2);
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
      if (url === '/api/v1/library/items/item-1/read-cycles' && method === 'GET')
        return { items: [{ id: 'cycle-1', started_at: '2026-02-08T00:00:00Z' }] };
      if (url === '/api/v1/read-cycles/cycle-1/progress-logs' && method === 'GET')
        return { items: [] };
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
      if (url === '/api/v1/works/work-1/covers' && method === 'GET') return { items: [] };
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
      if (url === '/api/v1/works/work-1/covers' && method === 'GET') return { items: [] };
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
    await clickButton(wrapper, 'Use image URL');
    await flushPromises();
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
    expect(options).toEqual([{ value: 'edition-blank', label: 'Edition' }]);
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

    expect((wrapper.vm as any).coverMode).toBe('choose');
    await clickButton(wrapper, 'Upload image');
    await flushPromises();
    expect((wrapper.vm as any).coverMode).toBe('upload');
    await clickButton(wrapper, 'Use image URL');
    await flushPromises();
    expect((wrapper.vm as any).coverMode).toBe('url');
    await clickButton(wrapper, 'Upload image');
    await flushPromises();
    expect((wrapper.vm as any).coverMode).toBe('upload');
    await clickButton(wrapper, 'Choose from Search');
    await flushPromises();
    expect((wrapper.vm as any).coverMode).toBe('choose');

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

  it('loads Open Library cover candidates and can select one', async () => {
    apiRequest.mockImplementation(async (url: string, opts?: any) => {
      const method = (opts?.method || 'GET').toUpperCase();

      if (url === '/api/v1/works/work-1' && method === 'GET') {
        return {
          id: 'work-1',
          title: 'Book A',
          description: null,
          cover_url: 'https://example.com/work.jpg',
          authors: [],
        };
      }
      if (url === '/api/v1/library/items/by-work/work-1' && method === 'GET') {
        return {
          id: 'item-1',
          work_id: 'work-1',
          preferred_edition_id: 'edition-1',
          cover_url: 'https://example.com/override.jpg',
          status: 'reading',
          created_at: '2026-02-01',
        };
      }
      if (url === '/api/v1/works/work-1/covers' && method === 'GET') {
        return {
          items: [
            {
              source: 'openlibrary',
              source_id: '10',
              cover_id: 10,
              thumbnail_url: 'thumb',
              image_url: 'img',
              source_url: 'img',
            },
          ],
        };
      }
      if (url === '/api/v1/works/work-1/covers/select' && method === 'POST') {
        expect(opts?.body).toEqual({ cover_id: 10 });
        return { scope: 'override', cover_url: 'https://example.com/override.jpg' };
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

    expect((wrapper.vm as any).coverMode).toBe('choose');
    expect(wrapper.findAll('[data-test="cover-candidates"]').length).toBe(1);

    await wrapper.find('[data-test="cover-candidate-10"]').trigger('click');
    await flushPromises();

    expect(apiRequest).toHaveBeenCalledWith('/api/v1/works/work-1/covers/select', {
      method: 'POST',
      body: { cover_id: 10 },
    });
    expect((wrapper.vm as any).coverDialogVisible).toBe(false);
  });

  it('selects a Google Books cover candidate via source_url', async () => {
    apiRequest.mockImplementation(async (url: string, opts?: any) => {
      const method = (opts?.method || 'GET').toUpperCase();

      if (url === '/api/v1/works/work-1' && method === 'GET') {
        return {
          id: 'work-1',
          title: 'Book A',
          description: null,
          cover_url: 'https://example.com/work.jpg',
          authors: [],
        };
      }
      if (url === '/api/v1/library/items/by-work/work-1' && method === 'GET') {
        return {
          id: 'item-1',
          work_id: 'work-1',
          preferred_edition_id: 'edition-1',
          cover_url: 'https://example.com/override.jpg',
          status: 'reading',
          created_at: '2026-02-01',
        };
      }
      if (url === '/api/v1/works/work-1/covers' && method === 'GET') {
        return {
          items: [
            {
              source: 'googlebooks',
              source_id: 'gb1',
              thumbnail_url: 'https://books.google.com/t.jpg',
              image_url: 'https://books.google.com/i.jpg',
              source_url: 'https://books.google.com/i.jpg',
            },
          ],
        };
      }
      if (url === '/api/v1/works/work-1/covers/select' && method === 'POST') {
        expect(opts?.body).toEqual({ source_url: 'https://books.google.com/i.jpg' });
        return { scope: 'override', cover_url: 'https://example.com/override.jpg' };
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

    await wrapper.find('[data-test="cover-candidate-gb1"]').trigger('click');
    await flushPromises();

    expect(apiRequest).toHaveBeenCalledWith('/api/v1/works/work-1/covers/select', {
      method: 'POST',
      body: { source_url: 'https://books.google.com/i.jpg' },
    });
    expect((wrapper.vm as any).coverDialogVisible).toBe(false);
  });

  it('renders cover candidate loading skeletons and Close button works', async () => {
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
      if (url === '/api/v1/works/work-1/covers' && method === 'GET') return { items: [] };
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

    (wrapper.vm as any).coverCandidatesLoading = true;
    await flushPromises();
    expect(wrapper.find('[data-test="dialog"]').findAll('.p-skeleton').length).toBeGreaterThan(0);

    (wrapper.vm as any).coverCandidatesLoading = false;
    await flushPromises();

    await clickButton(wrapper, 'Close');
    await flushPromises();
    expect((wrapper.vm as any).coverDialogVisible).toBe(false);
  });

  it('shows a helpful error when selecting a cover candidate fails', async () => {
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
      if (url === '/api/v1/works/work-1/covers' && method === 'GET') {
        return {
          items: [
            {
              source: 'openlibrary',
              source_id: '10',
              cover_id: 10,
              thumbnail_url: 'thumb',
              image_url: 'img',
              source_url: 'img',
            },
          ],
        };
      }
      if (url === '/api/v1/works/work-1/covers/select' && method === 'POST') {
        throw new ApiClientErrorMock('Nope', 'bad_request', 400);
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

    await wrapper.find('[data-test="cover-candidate-10"]').trigger('click');
    await flushPromises();

    expect((wrapper.vm as any).coverError).toContain('Nope');
    expect((wrapper.vm as any).coverDialogVisible).toBe(true);
  });

  it('surfaces ApiClientError when cover candidates fail to load', async () => {
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
      if (url === '/api/v1/works/work-1/covers' && method === 'GET') {
        throw new ApiClientErrorMock('Nope', 'bad_request', 400);
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

    expect((wrapper.vm as any).coverError).toContain('Nope');
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
    const original = Date.prototype.toLocaleDateString;
    Date.prototype.toLocaleDateString = () => {
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
      if (url === '/api/v1/library/items/item-1/read-cycles' && method === 'GET') {
        return {
          items: [{ id: 'cycle-1', started_at: '2026-02-08T00:00:00Z' }],
        };
      }
      if (url === '/api/v1/read-cycles/cycle-1/progress-logs' && method === 'GET') {
        return {
          items: [
            {
              id: 'session-1',
              logged_at: '2026-02-08T00:00:00Z',
              unit: 'pages_read',
              value: 1,
              canonical_percent: 1,
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

    Date.prototype.toLocaleDateString = original;
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
      if (url === '/api/v1/library/items/item-1/read-cycles' && method === 'GET') {
        return { items: [{ id: 'cycle-1', started_at: '2026-02-08T00:00:00Z' }] };
      }
      if (url === '/api/v1/read-cycles/cycle-1/progress-logs' && method === 'GET') {
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

      if (url === '/api/v1/read-cycles/cycle-1/progress-logs' && method === 'POST') {
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
    (wrapper.vm as any).libraryItem = { id: 'item-1', status: 'reading' };
    (wrapper.vm as any).sessionProgressValue = 1;
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

  it('loads discovery sections when work has authors', async () => {
    apiRequest.mockImplementation(async (url: string) => {
      if (url === '/api/v1/works/work-1') {
        return {
          id: 'work-1',
          title: 'Book A',
          description: null,
          cover_url: null,
          authors: [{ id: 'author-1', name: 'Author A' }],
        };
      }
      if (url === '/api/v1/library/items/by-work/work-1') {
        throw new ApiClientErrorMock('Not found', 'not_found', 404);
      }
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
              cover_url: 'https://example.com/author-work.jpg',
            },
          ],
        };
      }
      throw new Error(`unexpected request: ${url}`);
    });

    const wrapper = mountPage();
    await flushPromises();
    expect(wrapper.text()).toContain('Related One');
    expect(wrapper.text()).toContain('Other Book');
  });

  it('imports and navigates when selecting a related book', async () => {
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
        throw new ApiClientErrorMock('Not found', 'not_found', 404);
      }
      if (url === '/api/v1/works/work-1/related' && method === 'GET') {
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
      if (url === '/api/v1/authors/author-1' && method === 'GET') {
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
        return { work: { id: 'work-2' } };
      }
      throw new Error(`unexpected request: ${method} ${url}`);
    });

    const wrapper = mountPage();
    await flushPromises();
    await wrapper.get('[data-test="related-book-/works/OL2W"]').trigger('click');
    await flushPromises();

    expect(apiRequest).toHaveBeenCalledWith('/api/v1/books/import', {
      method: 'POST',
      body: { work_key: '/works/OL2W' },
    });
    expect(navigateToMock).toHaveBeenCalledWith('/books/work-2');
  });

  it('shows generic toast when importing a related book fails', async () => {
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
        throw new ApiClientErrorMock('Not found', 'not_found', 404);
      }
      if (url === '/api/v1/works/work-1/related' && method === 'GET') {
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
      if (url === '/api/v1/authors/author-1' && method === 'GET') {
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

    const wrapper = mountPage();
    await flushPromises();
    await wrapper.get('[data-test="related-book-/works/OL2W"]').trigger('click');
    await flushPromises();
    expect(toastAdd).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'error', summary: 'Unable to open related book.' }),
    );
  });

  it('binds remove dialog visibility through v-model updates', async () => {
    apiRequest.mockImplementation(async (url: string, opts?: any) => {
      const method = (opts?.method || 'GET').toUpperCase();
      if (url === '/api/v1/works/work-1' && method === 'GET') {
        return { id: 'work-1', title: 'Book A', description: null, cover_url: null, authors: [] };
      }
      if (url === '/api/v1/library/items/by-work/work-1' && method === 'GET') {
        return { id: 'item-1', work_id: 'work-1', status: 'reading', created_at: '2026-02-01' };
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
    await emitDialogVisible(wrapper, 'Remove from library', true);
    expect((wrapper.vm as any).removeConfirmOpen).toBe(true);
    await emitDialogVisible(wrapper, 'Remove from library', false);
    expect((wrapper.vm as any).removeConfirmOpen).toBe(false);
  });

  it('covers generic remove, cover-candidate fallback, and generic select-cover errors', async () => {
    apiRequest.mockImplementation(async (url: string, opts?: any) => {
      const method = (opts?.method || 'GET').toUpperCase();
      if (url === '/api/v1/works/work-1' && method === 'GET') {
        return { id: 'work-1', title: 'Book A', description: null, cover_url: null, authors: [] };
      }
      if (url === '/api/v1/library/items/by-work/work-1' && method === 'GET') {
        return { id: 'item-1', work_id: 'work-1', status: 'reading', created_at: '2026-02-01' };
      }
      if (url === '/api/v1/library/items/item-1/sessions' && method === 'GET') return { items: [] };
      if (url === '/api/v1/library/items/item-1/notes' && method === 'GET') return { items: [] };
      if (url === '/api/v1/library/items/item-1/highlights' && method === 'GET')
        return { items: [] };
      if (url === '/api/v1/me/reviews' && method === 'GET') return { items: [] };
      if (url === '/api/v1/library/items/item-1' && method === 'DELETE') throw new Error('boom');
      if (url === '/api/v1/works/work-1/covers' && method === 'GET') return {};
      if (url === '/api/v1/works/work-1/covers/select' && method === 'POST')
        throw new Error('boom');
      throw new Error(`unexpected request: ${method} ${url}`);
    });

    const wrapper = mountPage();
    await flushPromises();
    (wrapper.vm as any).libraryItem = { id: 'item-1' };
    await (wrapper.vm as any).confirmRemove();
    expect((wrapper.vm as any).error).toBe('Unable to remove this item right now.');
    await (wrapper.vm as any).loadCoverCandidates();
    expect((wrapper.vm as any).coverCandidates).toEqual([]);
    await (wrapper.vm as any).selectCoverCandidate({
      source: 'openlibrary',
      source_id: '1',
      cover_id: 1,
      thumbnail_url: 'thumb',
      image_url: 'img',
      source_url: 'img',
    });
    expect((wrapper.vm as any).coverError).toBe('Unable to set cover.');
  });

  it('opens enrich metadata dialog and loads candidates', async () => {
    apiRequest.mockImplementation(async (url: string, opts?: any) => {
      const method = (opts?.method || 'GET').toUpperCase();
      if (url === '/api/v1/works/work-1' && method === 'GET') {
        return {
          id: 'work-1',
          title: 'Book A',
          description: 'Current',
          cover_url: null,
          authors: [],
        };
      }
      if (url === '/api/v1/library/items/by-work/work-1' && method === 'GET') {
        throw new ApiClientErrorMock('Not found', 'not_found', 404);
      }
      if (url === '/api/v1/works/work-1/enrichment/candidates' && method === 'GET') {
        return {
          work_id: 'work-1',
          edition_target: { id: 'edition-1', label: 'Edition 1' },
          providers: {
            attempted: ['openlibrary', 'googlebooks'],
            succeeded: ['openlibrary'],
            failed: [{ provider: 'googlebooks', message: 'down' }],
          },
          fields: [
            {
              field_key: 'work.description',
              scope: 'work',
              current_value: 'Current',
              has_conflict: true,
              candidates: [
                {
                  provider: 'openlibrary',
                  provider_id: '/works/OL1W',
                  value: 'Suggested',
                  display_value: 'Suggested',
                  source_label: 'Open Library OL1W',
                },
              ],
            },
          ],
        };
      }
      throw new Error(`unexpected request: ${method} ${url}`);
    });

    const wrapper = mountPage();
    await flushPromises();
    await clickButton(wrapper, 'Enrich metadata');
    await flushPromises();

    expect((wrapper.vm as any).enrichDialogVisible).toBe(true);
    expect((wrapper.vm as any).enrichFields).toHaveLength(1);
    expect((wrapper.vm as any).enrichProviderWarnings[0]).toContain('Google Books');
  });

  it('renders cover enrichment as selectable preview cards with raw URL details', async () => {
    apiRequest.mockImplementation(async (url: string, opts?: any) => {
      const method = (opts?.method || 'GET').toUpperCase();
      if (url === '/api/v1/works/work-1' && method === 'GET') {
        return {
          id: 'work-1',
          title: 'Book A',
          description: 'Current',
          cover_url: 'https://current.example/cover.jpg',
          authors: [],
        };
      }
      if (url === '/api/v1/library/items/by-work/work-1' && method === 'GET') {
        throw new ApiClientErrorMock('Not found', 'not_found', 404);
      }
      if (url === '/api/v1/works/work-1/enrichment/candidates' && method === 'GET') {
        return {
          work_id: 'work-1',
          edition_target: null,
          providers: {
            attempted: ['openlibrary', 'googlebooks'],
            succeeded: ['openlibrary', 'googlebooks'],
            failed: [],
          },
          fields: [
            {
              field_key: 'work.cover_url',
              scope: 'work',
              current_value: 'https://current.example/cover.jpg',
              has_conflict: true,
              candidates: [
                {
                  provider: 'openlibrary',
                  provider_id: '/works/OL1W',
                  value: 'https://openlibrary.example/cover.jpg',
                  display_value: 'https://openlibrary.example/cover.jpg',
                  source_label: 'Open Library OL1W',
                },
                {
                  provider: 'googlebooks',
                  provider_id: 'gb1',
                  value: 'https://google.example/cover.jpg',
                  display_value: 'https://google.example/cover.jpg',
                  source_label: 'Google Books Example (gb1)',
                },
              ],
            },
          ],
        };
      }
      throw new Error(`unexpected request: ${method} ${url}`);
    });

    const wrapper = mountPage();
    await flushPromises();
    await clickButton(wrapper, 'Enrich metadata');
    await flushPromises();

    expect(wrapper.find('[data-test="book-enrich-cell-work.cover_url-current"]').exists()).toBe(
      true,
    );
    expect(wrapper.find('[data-test="book-enrich-cell-work.cover_url-openlibrary"]').exists()).toBe(
      true,
    );
    expect(wrapper.find('[data-test="book-enrich-cell-work.cover_url-googlebooks"]').exists()).toBe(
      true,
    );
    expect(wrapper.text()).toContain('Show raw URL');
  });

  it('shows cover fallback states when current and provider suggestions are missing', async () => {
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
        throw new ApiClientErrorMock('Not found', 'not_found', 404);
      }
      if (url === '/api/v1/works/work-1/enrichment/candidates' && method === 'GET') {
        return {
          work_id: 'work-1',
          edition_target: null,
          providers: {
            attempted: ['openlibrary', 'googlebooks'],
            succeeded: ['openlibrary'],
            failed: [],
          },
          fields: [
            {
              field_key: 'work.cover_url',
              scope: 'work',
              current_value: null,
              has_conflict: false,
              candidates: [
                {
                  provider: 'openlibrary',
                  provider_id: '/works/OL1W',
                  value: 'not-a-url',
                  display_value: 'not-a-url',
                  source_label: 'Open Library OL1W',
                },
              ],
            },
          ],
        };
      }
      throw new Error(`unexpected request: ${method} ${url}`);
    });

    const wrapper = mountPage();
    await flushPromises();
    await clickButton(wrapper, 'Enrich metadata');
    await flushPromises();

    expect(wrapper.text()).toContain('No current cover');
    expect(wrapper.text()).toContain('No Open Library result');
    expect(wrapper.text()).toContain('No Google Books result');
    const googleOption = wrapper.get(
      '[data-test="book-enrich-cell-work.cover_url-googlebooks"] input[type="radio"]',
    );
    expect((googleOption.element as HTMLInputElement).disabled).toBe(true);
  });

  it('updates note/highlight visibility selects including edit-note dialog select', async () => {
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
          created_at: '2026-02-01T00:00:00Z',
        };
      }
      if (url === '/api/v1/me' && method === 'GET') return { default_progress_unit: 'pages_read' };
      if (url === '/api/v1/library/items/item-1/read-cycles' && method === 'GET')
        return { items: [] };
      if (url === '/api/v1/library/items/item-1/statistics' && method === 'GET') {
        return {
          library_item_id: 'item-1',
          window: { days: 90, tz: 'UTC', start_date: '2026-01-01', end_date: '2026-02-10' },
          totals: { total_pages: 100, total_audio_minutes: 120 },
          counts: {
            total_cycles: 0,
            completed_cycles: 0,
            imported_cycles: 0,
            completed_reads: 0,
            total_logs: 0,
            logs_with_canonical: 0,
            logs_missing_canonical: 0,
          },
          current: {
            latest_logged_at: null,
            canonical_percent: 0,
            pages_read: 0,
            minutes_listened: 0,
          },
          streak: { non_zero_days: 0, last_non_zero_date: null },
          series: { progress_over_time: [], daily_delta: [] },
          timeline: [],
          data_quality: {
            has_missing_totals: false,
            unresolved_logs_exist: false,
            unresolved_log_ids: [],
          },
        };
      }
      if (url === '/api/v1/library/items/item-1/notes' && method === 'GET') {
        return {
          items: [
            {
              id: 'note-1',
              title: 'n',
              body: 'body',
              visibility: 'private',
              created_at: '2026-02-08T08:00:00Z',
            },
          ],
        };
      }
      if (url === '/api/v1/library/items/item-1/highlights' && method === 'GET') {
        return {
          items: [
            {
              id: 'h-1',
              quote: 'q',
              visibility: 'private',
              created_at: '2026-02-08T08:00:00Z',
            },
          ],
        };
      }
      if (url === '/api/v1/me/reviews' && method === 'GET') return { items: [] };
      throw new Error(`unexpected request: ${method} ${url}`);
    });

    const wrapper = mountPage();
    await flushPromises();

    const selects = wrapper.findAll('select');
    expect(selects.length).toBeGreaterThan(2);
    await selects[0]!.setValue('public');
    await selects[1]!.setValue('public');

    await clickButton(wrapper, 'Edit');
    await flushPromises();

    const dialogSelect = wrapper.findAll('select').at(-1);
    expect(dialogSelect).toBeTruthy();
    await dialogSelect!.setValue('unlisted');
  });

  it('allows selecting the current enrichment radio option', async () => {
    apiRequest.mockImplementation(async (url: string, opts?: any) => {
      const method = (opts?.method || 'GET').toUpperCase();
      if (url === '/api/v1/works/work-1' && method === 'GET') {
        return {
          id: 'work-1',
          title: 'Book A',
          description: 'Current',
          cover_url: 'https://current.example/cover.jpg',
          authors: [],
        };
      }
      if (url === '/api/v1/library/items/by-work/work-1' && method === 'GET') {
        throw new ApiClientErrorMock('Not found', 'not_found', 404);
      }
      if (url === '/api/v1/works/work-1/enrichment/candidates' && method === 'GET') {
        return {
          work_id: 'work-1',
          edition_target: null,
          providers: {
            attempted: ['openlibrary'],
            succeeded: ['openlibrary'],
            failed: [],
          },
          fields: [
            {
              field_key: 'work.cover_url',
              scope: 'work',
              current_value: 'https://current.example/cover.jpg',
              has_conflict: false,
              candidates: [
                {
                  provider: 'openlibrary',
                  provider_id: '/works/OL1W',
                  value: 'https://openlibrary.example/cover.jpg',
                  display_value: 'https://openlibrary.example/cover.jpg',
                  source_label: 'Open Library OL1W',
                },
              ],
            },
          ],
        };
      }
      throw new Error(`unexpected request: ${method} ${url}`);
    });

    const wrapper = mountPage();
    await flushPromises();
    await clickButton(wrapper, 'Enrich metadata');
    await flushPromises();

    const currentRadio = wrapper.get(
      '[data-test="book-enrich-cell-work.cover_url-current"] input[type="radio"]',
    );
    await currentRadio.trigger('change');
    expect((wrapper.vm as any).enrichSelectionByField['work.cover_url']).toBe('keep');
  });

  it('applies visibility/update helpers for note/highlight and enrichment selection state', async () => {
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
          created_at: '2026-02-01T00:00:00Z',
        };
      }
      if (url === '/api/v1/me' && method === 'GET') return { default_progress_unit: 'pages_read' };
      if (url === '/api/v1/library/items/item-1/read-cycles' && method === 'GET')
        return { items: [] };
      if (url === '/api/v1/library/items/item-1/statistics' && method === 'GET') {
        return {
          library_item_id: 'item-1',
          window: { days: 90, tz: 'UTC', start_date: '2026-01-01', end_date: '2026-02-10' },
          totals: { total_pages: 100, total_audio_minutes: 120 },
          counts: {
            total_cycles: 0,
            completed_cycles: 0,
            imported_cycles: 0,
            completed_reads: 0,
            total_logs: 0,
            logs_with_canonical: 0,
            logs_missing_canonical: 0,
          },
          current: {
            latest_logged_at: null,
            canonical_percent: 0,
            pages_read: 0,
            minutes_listened: 0,
          },
          streak: { non_zero_days: 0, last_non_zero_date: null },
          series: { progress_over_time: [], daily_delta: [] },
          timeline: [],
          data_quality: {
            has_missing_totals: false,
            unresolved_logs_exist: false,
            unresolved_log_ids: [],
          },
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

    (wrapper.vm as any).updateNewNoteVisibility(undefined);
    (wrapper.vm as any).updateNewNoteVisibility('public');
    (wrapper.vm as any).updateEditNoteVisibility(undefined);
    (wrapper.vm as any).updateEditNoteVisibility('public');
    (wrapper.vm as any).updateNewHighlightVisibility(undefined);
    (wrapper.vm as any).updateNewHighlightVisibility('unlisted');
    (wrapper.vm as any).setEnrichmentSelection('work.cover_url', 'keep');
    await flushPromises();

    expect((wrapper.vm as any).newNoteVisibility).toBe('public');
    expect((wrapper.vm as any).editNoteVisibility).toBe('public');
    expect((wrapper.vm as any).newHighlightVisibility).toBe('unlisted');
    expect((wrapper.vm as any).enrichSelectionByField['work.cover_url']).toBe('keep');
  });

  it('covers refresh/status guard paths for no-library and unchanged-status flows', async () => {
    apiRequest.mockImplementation(async (url: string, opts?: any) => {
      const method = (opts?.method || 'GET').toUpperCase();
      if (url === '/api/v1/works/work-1' && method === 'GET') {
        return { id: 'work-1', title: 'Book A', description: null, cover_url: null, authors: [] };
      }
      if (url === '/api/v1/library/items/by-work/work-1' && method === 'GET') {
        throw new ApiClientErrorMock('Not found', 'not_found', 404);
      }
      if (url === '/api/v1/me' && method === 'GET') return { default_progress_unit: 'pages_read' };
      if (url === '/api/v1/library/items/item-1' && method === 'PATCH') {
        return { id: 'item-1', status: opts?.body?.status };
      }
      throw new Error(`unexpected request: ${method} ${url}`);
    });

    const wrapper = mountPage();
    await flushPromises();

    await (wrapper.vm as any).refresh();
    await flushPromises();

    (wrapper.vm as any).openStatusEditor();
    (wrapper.vm as any).libraryItem = {
      id: 'item-1',
      work_id: 'work-1',
      preferred_edition_id: null,
      status: 'reading',
      created_at: '2026-02-01T00:00:00Z',
    };
    (wrapper.vm as any).openStatusEditor();
    await (wrapper.vm as any).onStatusSelected('reading');
    await (wrapper.vm as any).onStatusSelected('completed');
    await flushPromises();

    expect((wrapper.vm as any).libraryItem.status).toBe('completed');
  });

  it('picks all Open Library suggestions and applies selections', async () => {
    apiRequest.mockImplementation(async (url: string, opts?: any) => {
      const method = (opts?.method || 'GET').toUpperCase();
      if (url === '/api/v1/works/work-1' && method === 'GET') {
        return {
          id: 'work-1',
          title: 'Book A',
          description: 'Current',
          cover_url: null,
          authors: [],
        };
      }
      if (url === '/api/v1/library/items/by-work/work-1' && method === 'GET') {
        throw new ApiClientErrorMock('Not found', 'not_found', 404);
      }
      if (url === '/api/v1/works/work-1/enrichment/candidates' && method === 'GET') {
        return {
          work_id: 'work-1',
          edition_target: { id: 'edition-1', label: 'Edition 1' },
          providers: { attempted: ['openlibrary'], succeeded: ['openlibrary'], failed: [] },
          fields: [
            {
              field_key: 'work.description',
              scope: 'work',
              current_value: 'Current',
              has_conflict: false,
              candidates: [
                {
                  provider: 'openlibrary',
                  provider_id: '/works/OL1W',
                  value: 'Suggested',
                  display_value: 'Suggested',
                  source_label: 'Open Library OL1W',
                },
              ],
            },
          ],
        };
      }
      if (url === '/api/v1/works/work-1/enrichment/apply' && method === 'POST') {
        expect(opts?.body).toEqual({
          edition_id: 'edition-1',
          selections: [
            {
              field_key: 'work.description',
              provider: 'openlibrary',
              provider_id: '/works/OL1W',
              value: 'Suggested',
            },
          ],
        });
        return { updated: ['work.description'], skipped: [] };
      }
      throw new Error(`unexpected request: ${method} ${url}`);
    });

    const wrapper = mountPage();
    await flushPromises();
    await clickButton(wrapper, 'Enrich metadata');
    await flushPromises();
    await clickButton(wrapper, 'Pick all Open Library');
    await flushPromises();

    expect(toastAdd).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'success', summary: 'Updated 1 fields.' }),
    );
  });

  it('shows enrich error state when apply fails', async () => {
    apiRequest.mockImplementation(async (url: string, opts?: any) => {
      const method = (opts?.method || 'GET').toUpperCase();
      if (url === '/api/v1/works/work-1' && method === 'GET') {
        return {
          id: 'work-1',
          title: 'Book A',
          description: 'Current',
          cover_url: null,
          authors: [],
        };
      }
      if (url === '/api/v1/library/items/by-work/work-1' && method === 'GET') {
        throw new ApiClientErrorMock('Not found', 'not_found', 404);
      }
      if (url === '/api/v1/works/work-1/enrichment/candidates' && method === 'GET') {
        return {
          work_id: 'work-1',
          edition_target: null,
          providers: { attempted: ['openlibrary'], succeeded: ['openlibrary'], failed: [] },
          fields: [
            {
              field_key: 'work.description',
              scope: 'work',
              current_value: 'Current',
              has_conflict: false,
              candidates: [
                {
                  provider: 'openlibrary',
                  provider_id: '/works/OL1W',
                  value: 'Suggested',
                  display_value: 'Suggested',
                  source_label: 'Open Library OL1W',
                },
              ],
            },
          ],
        };
      }
      if (url === '/api/v1/works/work-1/enrichment/apply' && method === 'POST') {
        throw new Error('boom');
      }
      throw new Error(`unexpected request: ${method} ${url}`);
    });

    const wrapper = mountPage();
    await flushPromises();
    await clickButton(wrapper, 'Enrich metadata');
    await flushPromises();
    await clickButton(wrapper, 'Pick all Open Library');
    await flushPromises();

    expect((wrapper.vm as any).enrichError).toBe('Unable to apply enrichment selections.');
  });

  it('picks all Google Books enrichment candidates and applies selections', async () => {
    apiRequest.mockImplementation(async (url: string, opts?: any) => {
      const method = (opts?.method || 'GET').toUpperCase();
      if (url === '/api/v1/works/work-1' && method === 'GET') {
        return {
          id: 'work-1',
          title: 'Book A',
          description: 'Current',
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
      if (url === '/api/v1/library/items/item-1/read-cycles' && method === 'GET')
        return { items: [] };
      if (url === '/api/v1/library/items/item-1/notes' && method === 'GET') return { items: [] };
      if (url === '/api/v1/library/items/item-1/highlights' && method === 'GET')
        return { items: [] };
      if (url === '/api/v1/me/reviews' && method === 'GET') return { items: [] };
      if (url === '/api/v1/works/work-1/enrichment/candidates' && method === 'GET') {
        return {
          work_id: 'work-1',
          edition_target: { id: 'edition-1', label: 'Preferred' },
          providers: {
            attempted: ['openlibrary', 'googlebooks'],
            succeeded: ['openlibrary', 'googlebooks'],
            failed: [],
          },
          fields: [
            {
              field_key: 'work.description',
              scope: 'work',
              current_value: 'Current',
              has_conflict: true,
              candidates: [
                {
                  provider: 'openlibrary',
                  provider_id: '/works/OL1W',
                  value: 'OL Suggestion',
                  display_value: 'OL Suggestion',
                  source_label: 'Open Library OL1W',
                },
                {
                  provider: 'googlebooks',
                  provider_id: 'g1',
                  value: 'GB Suggestion',
                  display_value: 'GB Suggestion',
                  source_label: 'Google Books g1',
                },
              ],
            },
          ],
        };
      }
      if (url === '/api/v1/works/work-1/enrichment/apply' && method === 'POST') {
        expect(opts?.body).toEqual({
          edition_id: 'edition-1',
          selections: [
            {
              field_key: 'work.description',
              provider: 'googlebooks',
              provider_id: 'g1',
              value: 'GB Suggestion',
            },
          ],
        });
        return { updated: ['work.description'], skipped: [] };
      }
      throw new Error(`unexpected request: ${method} ${url}`);
    });

    const wrapper = mountPage();
    await flushPromises();
    await clickButton(wrapper, 'Enrich metadata');
    await flushPromises();
    await clickButton(wrapper, 'Pick all Google Books');
    await flushPromises();

    expect(toastAdd).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'success', summary: 'Updated 1 fields.' }),
    );
  });

  it('uses image_url as cover candidate key fallback', async () => {
    apiRequest.mockImplementation(async (url: string) => {
      if (url === '/api/v1/works/work-1') {
        return { id: 'work-1', title: 'Book A', description: null, cover_url: null, authors: [] };
      }
      if (url === '/api/v1/library/items/by-work/work-1') {
        throw new ApiClientErrorMock('Not found', 'not_found', 404);
      }
      throw new Error(`unexpected request: ${url}`);
    });

    const wrapper = mountPage();
    await flushPromises();
    const key = (wrapper.vm as any).coverCandidateKey({
      source: 'googlebooks',
      source_id: '',
      thumbnail_url: 'thumb',
      image_url: 'https://example.com/image.jpg',
    });
    expect(key).toBe('https://example.com/image.jpg');
  });

  it('resets enrich state when candidate loading fails', async () => {
    apiRequest.mockImplementation(async (url: string, opts?: any) => {
      const method = (opts?.method || 'GET').toUpperCase();
      if (url === '/api/v1/works/work-1' && method === 'GET') {
        return { id: 'work-1', title: 'Book A', description: null, cover_url: null, authors: [] };
      }
      if (url === '/api/v1/library/items/by-work/work-1' && method === 'GET') {
        throw new ApiClientErrorMock('Not found', 'not_found', 404);
      }
      if (url === '/api/v1/works/work-1/enrichment/candidates' && method === 'GET') {
        throw new Error('boom');
      }
      throw new Error(`unexpected request: ${method} ${url}`);
    });

    const wrapper = mountPage();
    await flushPromises();
    await clickButton(wrapper, 'Enrich metadata');
    await flushPromises();

    expect((wrapper.vm as any).enrichFields).toEqual([]);
    expect((wrapper.vm as any).enrichEditionTarget).toBeNull();
    expect((wrapper.vm as any).enrichProviderWarnings).toEqual([]);
    expect((wrapper.vm as any).enrichError).toBe('Unable to load enrichment candidates.');
  });

  it('binds enrich dialog v-model, cancel close, and object formatting branch', async () => {
    apiRequest.mockImplementation(async (url: string, opts?: any) => {
      const method = (opts?.method || 'GET').toUpperCase();
      if (url === '/api/v1/works/work-1' && method === 'GET') {
        return { id: 'work-1', title: 'Book A', description: null, cover_url: null, authors: [] };
      }
      if (url === '/api/v1/library/items/by-work/work-1' && method === 'GET') {
        throw new ApiClientErrorMock('Not found', 'not_found', 404);
      }
      if (url === '/api/v1/works/work-1/enrichment/candidates' && method === 'GET') {
        return {
          work_id: 'work-1',
          edition_target: { id: 'edition-1', label: 'Edition 1' },
          providers: { attempted: ['openlibrary'], succeeded: ['openlibrary'], failed: [] },
          fields: [
            {
              field_key: 'work.description',
              scope: 'work',
              current_value: { nested: true },
              has_conflict: false,
              candidates: [
                {
                  provider: 'openlibrary',
                  provider_id: '/works/OL1W',
                  value: 'Suggested',
                  display_value: 'Suggested',
                  source_label: 'Open Library OL1W',
                },
              ],
            },
          ],
        };
      }
      throw new Error(`unexpected request: ${method} ${url}`);
    });

    const wrapper = mountPage();
    await flushPromises();
    await clickButton(wrapper, 'Enrich metadata');
    await flushPromises();
    expect((wrapper.vm as any).formatEnrichmentValue({ nested: true })).toBe('{"nested":true}');

    await emitDialogVisible(wrapper, 'Enrich metadata', true);
    expect((wrapper.vm as any).enrichDialogVisible).toBe(true);
    (wrapper.vm as any).enrichSelectionByField = { 'work.description': 'openlibrary' };
    expect((wrapper.vm as any).enrichSelectionByField['work.description']).toBe('openlibrary');
    await clickButton(wrapper, 'Cancel');
    expect((wrapper.vm as any).enrichDialogVisible).toBe(false);
  });

  it('shows enrich success summary with skipped count', async () => {
    apiRequest.mockImplementation(async (url: string, opts?: any) => {
      const method = (opts?.method || 'GET').toUpperCase();
      if (url === '/api/v1/works/work-1' && method === 'GET') {
        return {
          id: 'work-1',
          title: 'Book A',
          description: 'Current',
          cover_url: null,
          authors: [],
        };
      }
      if (url === '/api/v1/library/items/by-work/work-1' && method === 'GET') {
        throw new ApiClientErrorMock('Not found', 'not_found', 404);
      }
      if (url === '/api/v1/works/work-1/enrichment/candidates' && method === 'GET') {
        return {
          work_id: 'work-1',
          edition_target: { id: 'edition-1', label: 'Edition 1' },
          providers: { attempted: ['openlibrary'], succeeded: ['openlibrary'], failed: [] },
          fields: [
            {
              field_key: 'work.description',
              scope: 'work',
              current_value: 'Current',
              has_conflict: false,
              candidates: [
                {
                  provider: 'openlibrary',
                  provider_id: '/works/OL1W',
                  value: 'Suggested',
                  display_value: 'Suggested',
                  source_label: 'Open Library OL1W',
                },
              ],
            },
          ],
        };
      }
      if (url === '/api/v1/works/work-1/enrichment/apply' && method === 'POST') {
        return {
          updated: ['work.description'],
          skipped: [{ field_key: 'edition.publisher', reason: 'target_missing' }],
        };
      }
      throw new Error(`unexpected request: ${method} ${url}`);
    });

    const wrapper = mountPage();
    await flushPromises();
    await clickButton(wrapper, 'Enrich metadata');
    await flushPromises();
    await clickButton(wrapper, 'Pick all Open Library');
    await flushPromises();

    expect(toastAdd).toHaveBeenCalledWith(
      expect.objectContaining({ summary: 'Updated 1 fields, skipped 1.' }),
    );
  });

  it('drops missing provider candidate entries before enrich apply payload', async () => {
    apiRequest.mockImplementation(async (url: string, opts?: any) => {
      const method = (opts?.method || 'GET').toUpperCase();
      if (url === '/api/v1/works/work-1' && method === 'GET') {
        return {
          id: 'work-1',
          title: 'Book A',
          description: 'Current',
          cover_url: null,
          authors: [],
        };
      }
      if (url === '/api/v1/library/items/by-work/work-1' && method === 'GET') {
        throw new ApiClientErrorMock('Not found', 'not_found', 404);
      }
      if (url === '/api/v1/works/work-1/enrichment/candidates' && method === 'GET') {
        return {
          work_id: 'work-1',
          edition_target: { id: 'edition-1', label: 'Edition 1' },
          providers: { attempted: ['openlibrary'], succeeded: ['openlibrary'], failed: [] },
          fields: [
            {
              field_key: 'work.description',
              scope: 'work',
              current_value: 'Current',
              has_conflict: false,
              candidates: [],
            },
          ],
        };
      }
      if (url === '/api/v1/works/work-1/enrichment/apply' && method === 'POST') {
        expect(opts?.body.selections).toEqual([]);
        return { updated: [], skipped: [] };
      }
      throw new Error(`unexpected request: ${method} ${url}`);
    });

    const wrapper = mountPage();
    await flushPromises();
    await clickButton(wrapper, 'Enrich metadata');
    await flushPromises();
    (wrapper.vm as any).enrichSelectionByField = {
      'work.description': 'openlibrary',
    };
    await (wrapper.vm as any).applyEnrichmentSelections();
    await flushPromises();
  });

  it('covers enrich pick/reset branches and ApiClientError apply path', async () => {
    let capturedApplyBody: any = null;
    let applyCalls = 0;
    apiRequest.mockImplementation(async (url: string, opts?: any) => {
      const method = (opts?.method || 'GET').toUpperCase();
      if (url === '/api/v1/works/work-1' && method === 'GET') {
        return { id: 'work-1', title: 'Book A', description: null, cover_url: null, authors: [] };
      }
      if (url === '/api/v1/library/items/by-work/work-1' && method === 'GET') {
        throw new ApiClientErrorMock('Not found', 'not_found', 404);
      }
      if (url === '/api/v1/works/work-1/enrichment/apply' && method === 'POST') {
        applyCalls += 1;
        capturedApplyBody = opts?.body;
        throw new ApiClientErrorMock('Bad request', 'bad_request', 400);
      }
      throw new Error(`unexpected request: ${method} ${url}`);
    });

    const wrapper = mountPage();
    await flushPromises();
    (wrapper.vm as any).enrichFields = [
      {
        field_key: 'work.description',
        scope: 'work',
        current_value: 'Current',
        has_conflict: false,
        candidates: [{ provider: 'openlibrary', provider_id: '/works/OL1W', value: 'Suggested' }],
      },
    ];
    (wrapper.vm as any).initializeEnrichmentSelections((wrapper.vm as any).enrichFields);
    await (wrapper.vm as any).pickAllFromProvider('openlibrary');
    expect((wrapper.vm as any).enrichSelectionByField['work.description']).toBe('openlibrary');
    expect(applyCalls).toBe(1);
    expect(capturedApplyBody?.selections).toEqual([
      {
        field_key: 'work.description',
        provider: 'openlibrary',
        provider_id: '/works/OL1W',
        value: 'Suggested',
      },
    ]);
    (wrapper.vm as any).resetAllToCurrent();
    expect((wrapper.vm as any).enrichSelectionByField['work.description']).toBe('keep');

    (wrapper.vm as any).enrichSelectionByField = { 'work.description': 'googlebooks' };
    await (wrapper.vm as any).applyEnrichmentSelections();
    expect(capturedApplyBody?.selections).toEqual([]);
    expect(applyCalls).toBe(2);
    expect((wrapper.vm as any).enrichError).toBe('Bad request');
  });

  it('orders cover enrichment row first', async () => {
    apiRequest.mockImplementation(async (url: string) => {
      if (url === '/api/v1/works/work-1') {
        return { id: 'work-1', title: 'Book A', description: null, cover_url: null, authors: [] };
      }
      if (url === '/api/v1/library/items/by-work/work-1') {
        throw new ApiClientErrorMock('Not found', 'not_found', 404);
      }
      throw new Error(`unexpected request: ${url}`);
    });

    const wrapper = mountPage();
    await flushPromises();

    (wrapper.vm as any).enrichFields = [
      {
        field_key: 'work.description',
        scope: 'work',
        current_value: null,
        has_conflict: false,
        candidates: [],
      },
      {
        field_key: 'work.cover_url',
        scope: 'work',
        current_value: null,
        has_conflict: false,
        candidates: [],
      },
    ];

    const rows = (wrapper.vm as any).enrichRows;
    expect(rows[0].fieldKey).toBe('work.cover_url');
    expect(rows[1].fieldKey).toBe('work.description');
  });

  it('returns image URL only for http/https enrichment values', async () => {
    apiRequest.mockImplementation(async (url: string) => {
      if (url === '/api/v1/works/work-1') {
        return { id: 'work-1', title: 'Book A', description: null, cover_url: null, authors: [] };
      }
      if (url === '/api/v1/library/items/by-work/work-1') {
        throw new ApiClientErrorMock('Not found', 'not_found', 404);
      }
      throw new Error(`unexpected request: ${url}`);
    });

    const wrapper = mountPage();
    await flushPromises();

    expect((wrapper.vm as any).toEnrichmentImageUrl('https://example.com/cover.jpg')).toBe(
      'https://example.com/cover.jpg',
    );
    expect((wrapper.vm as any).toEnrichmentImageUrl('http://example.com/cover.jpg')).toBe(
      'http://example.com/cover.jpg',
    );
    expect((wrapper.vm as any).toEnrichmentImageUrl('not-a-url')).toBeNull();
    expect((wrapper.vm as any).toEnrichmentImageUrl(null)).toBeNull();
  });

  it('returns early from confirmRemove when no library item exists', async () => {
    apiRequest.mockImplementation(async (url: string) => {
      if (url === '/api/v1/works/work-1') {
        return { id: 'work-1', title: 'Book A', description: null, cover_url: null, authors: [] };
      }
      if (url === '/api/v1/library/items/by-work/work-1') {
        throw new ApiClientErrorMock('Not found', 'not_found', 404);
      }
      throw new Error(`unexpected request: ${url}`);
    });

    const wrapper = mountPage();
    await flushPromises();
    await (wrapper.vm as any).confirmRemove();
    expect(apiRequest).not.toHaveBeenCalledWith('/api/v1/library/items/item-1', {
      method: 'DELETE',
    });
  });

  it('skips review error updates when response is stale', async () => {
    let wrapper: any;
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
        (wrapper.vm as any).runId += 1;
        throw new Error('stale');
      }
      throw new Error(`unexpected request: ${method} ${url}`);
    });

    wrapper = mountPage();
    await flushPromises();
    expect((wrapper.vm as any).reviewError).toBe('');
  });

  it('uses image_url fallback when selecting a non-openlibrary candidate', async () => {
    apiRequest.mockImplementation(async (url: string, opts?: any) => {
      const method = (opts?.method || 'GET').toUpperCase();
      if (url === '/api/v1/works/work-1' && method === 'GET') {
        return { id: 'work-1', title: 'Book A', description: null, cover_url: null, authors: [] };
      }
      if (url === '/api/v1/library/items/by-work/work-1' && method === 'GET') {
        return { id: 'item-1', work_id: 'work-1', status: 'reading', created_at: '2026-02-01' };
      }
      if (url === '/api/v1/library/items/item-1/sessions' && method === 'GET') return { items: [] };
      if (url === '/api/v1/library/items/item-1/notes' && method === 'GET') return { items: [] };
      if (url === '/api/v1/library/items/item-1/highlights' && method === 'GET')
        return { items: [] };
      if (url === '/api/v1/me/reviews' && method === 'GET') return { items: [] };
      if (url === '/api/v1/works/work-1/covers/select' && method === 'POST') {
        expect(opts?.body).toEqual({ source_url: 'https://example.com/fallback.jpg' });
        return { scope: 'global', cover_url: 'https://example.com/fallback.jpg' };
      }
      throw new Error(`unexpected request: ${method} ${url}`);
    });

    const wrapper = mountPage();
    await flushPromises();
    await (wrapper.vm as any).selectCoverCandidate({
      source: 'googlebooks',
      source_id: 'gb1',
      source_url: '',
      thumbnail_url: 'thumb',
      image_url: 'https://example.com/fallback.jpg',
    });
  });

  it('covers remaining session/dialog/select/radio bindings and api-error branches', async () => {
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
      if (url === '/api/v1/me' && method === 'GET') return { default_progress_unit: 'pages_read' };
      if (url === '/api/v1/library/items/item-1/read-cycles' && method === 'GET') {
        return { items: [{ id: 'cycle-1', started_at: '2026-02-08T00:00:00Z' }] };
      }
      if (url === '/api/v1/read-cycles/cycle-1/progress-logs' && method === 'GET') {
        throw new ApiClientErrorMock('sessions err', 'sessions_err', 500);
      }
      if (url === '/api/v1/library/items/item-1/notes' && method === 'GET') {
        throw new ApiClientErrorMock('notes err', 'notes_err', 500);
      }
      if (url === '/api/v1/library/items/item-1/highlights' && method === 'GET') {
        throw new ApiClientErrorMock('highlights err', 'highlights_err', 500);
      }
      if (url === '/api/v1/me/reviews' && method === 'GET') return { items: [] };
      if (url === '/api/v1/library/items/item-1' && method === 'PATCH') {
        throw new ApiClientErrorMock('status err', 'status_err', 500);
      }
      if (url === '/api/v1/works/work-1/enrichment/candidates' && method === 'GET') {
        return {
          work_id: 'work-1',
          edition_target: { id: 'edition-1', label: 'Preferred' },
          providers: {
            attempted: ['openlibrary', 'googlebooks'],
            succeeded: ['openlibrary', 'googlebooks'],
            failed: [],
          },
          fields: [
            {
              field_key: 'work.cover_url',
              scope: 'work',
              current_value: null,
              has_conflict: true,
              candidates: [
                {
                  provider: 'openlibrary',
                  provider_id: '/works/OL1W',
                  value: 'https://example.com/ol.jpg',
                  display_value: 'https://example.com/ol.jpg',
                  source_label: 'Open Library',
                },
                {
                  provider: 'googlebooks',
                  provider_id: 'g1',
                  value: 'https://example.com/gb.jpg',
                  display_value: 'https://example.com/gb.jpg',
                  source_label: 'Google Books',
                },
              ],
            },
          ],
        };
      }
      throw new Error(`unexpected request: ${method} ${url}`);
    });

    const wrapper = mountPage();
    await flushPromises();

    const range = wrapper.find('input[type="range"]');
    expect(range.exists()).toBe(true);
    await range.setValue('10');
    const dateInput = wrapper.find('input[type="date"]');
    expect(dateInput.exists()).toBe(true);
    await dateInput.setValue('2026-02-07');

    await emitDialogVisible(wrapper, 'Lower progress?', false);
    await emitDialogVisible(wrapper, 'Add missing totals', false);

    await wrapper.get('[data-test="book-status-open"]').trigger('click');
    await wrapper.get('[data-test="book-status-select"]').setValue('completed');
    await flushPromises();
    expect((wrapper.vm as any).error).toContain('status err');

    await clickButton(wrapper, 'Enrich metadata');
    await flushPromises();
    const radios = wrapper.findAll('input[type="radio"]');
    expect(radios.length).toBeGreaterThanOrEqual(3);
    await radios[0]!.setValue();
    await radios[1]!.setValue();
    await radios[2]!.setValue();

    expect((wrapper.vm as any).sessionsError).toBe('sessions err');
    expect((wrapper.vm as any).notesError).toBe('notes err');
    expect((wrapper.vm as any).highlightsError).toBe('highlights err');
  });
});
