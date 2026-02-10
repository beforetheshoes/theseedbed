import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import PrimeVue from 'primevue/config';

const toastAdd = vi.hoisted(() => vi.fn());
const navigateToMock = vi.hoisted(() => vi.fn());
const getUserMock = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ data: { user: { email: 'reader@theseedbed.app' } } }),
);
const signOutMock = vi.hoisted(() => vi.fn().mockResolvedValue({}));

const apiRequestMock = vi.hoisted(() => vi.fn());
const supabaseClientRef = vi.hoisted(() => ({
  current: { auth: { getUser: getUserMock, signOut: signOutMock } } as any,
}));
const colorModeRef = vi.hoisted(() => {
  const { ref } = require('vue');
  return ref<'light' | 'dark' | 'system'>('system');
});
const setModeMock = vi.hoisted(() => vi.fn());

vi.mock('#imports', () => ({
  useSupabaseClient: () => supabaseClientRef.current,
  navigateTo: navigateToMock,
}));

vi.mock('primevue/usetoast', () => ({
  useToast: () => ({ add: toastAdd }),
}));

vi.mock('~/composables/useColorMode', () => {
  return {
    useColorMode: () => ({
      mode: colorModeRef,
      setMode: setModeMock,
    }),
  };
});

vi.mock('~/utils/api', async () => {
  const actual = await vi.importActual<any>('~/utils/api');
  return {
    ...actual,
    apiRequest: apiRequestMock,
  };
});

import { ApiClientError } from '~/utils/api';
import AppTopBar from '../../../app/components/shell/AppTopBar.vue';

const MenubarStub = defineComponent({
  name: 'Menubar',
  setup:
    (_props, { slots, attrs }) =>
    () =>
      h('div', { ...attrs }, [slots.start?.(), slots.end?.()]),
});

const ButtonStub = defineComponent({
  name: 'Button',
  emits: ['click'],
  setup:
    (_props, { attrs, slots, emit }) =>
    () =>
      h(
        'button',
        { ...attrs, onClick: (e: any) => emit('click', e) },
        slots.default?.({ class: 'p-button' }),
      ),
});

const ToggleSwitchStub = defineComponent({
  name: 'ToggleSwitch',
  props: ['modelValue'],
  emits: ['update:modelValue'],
  setup:
    (props, { emit, attrs }) =>
    () =>
      h('button', {
        ...attrs,
        'data-test': attrs['data-test'] ?? 'toggle',
        onClick: () => emit('update:modelValue', !props.modelValue),
      }),
});

const AutoCompleteStub = defineComponent({
  name: 'AutoComplete',
  props: ['modelValue', 'suggestions', 'optionGroupLabel', 'optionGroupChildren', 'optionLabel'],
  emits: ['complete', 'item-select', 'update:modelValue'],
  setup: (props, { emit, slots, attrs }) => {
    // Emit both v-model update and complete so the component's generated v-model handlers
    // are exercised for coverage.
    const triggerComplete = () => {
      emit('update:modelValue', 'ha');
      emit('complete', { query: 'ha' });
    };
    const triggerCompleteShort = () => {
      emit('update:modelValue', 'a');
      emit('complete', { query: 'a' });
    };
    const triggerCompleteHat = () => {
      emit('update:modelValue', 'hat');
      emit('complete', { query: 'hat' });
    };
    const items = () => (props.suggestions || []) as Array<any>;

    return () =>
      h('div', { ...attrs }, [
        typeof props.optionLabel === 'function'
          ? h('span', { style: 'display:none' }, String(props.optionLabel(props.modelValue)))
          : null,
        h('button', { 'data-test': 'ac-complete', onClick: triggerComplete }, 'complete'),
        h('button', { 'data-test': 'ac-complete-short', onClick: triggerCompleteShort }, 'short'),
        h('button', { 'data-test': 'ac-complete-hat', onClick: triggerCompleteHat }, 'hat'),
        ...items().flatMap((group: any, groupIndex: number) => {
          const label = group[props.optionGroupLabel || 'label'];
          const children = group[props.optionGroupChildren || 'items'] || [];
          const header = slots.optiongroup
            ? slots.optiongroup({ option: group })
            : h('div', { 'data-test': `group-${groupIndex}` }, String(label));

          const options = children.map((opt: any, optIndex: number) =>
            h(
              'button',
              {
                key: optIndex,
                'data-test': `ac-option-${opt.kind}-${opt.kind === 'library' ? opt.work_id : opt.work_key}`,
                onClick: () => emit('item-select', { value: opt }),
              },
              slots.option
                ? [
                    typeof props.optionLabel === 'function'
                      ? h('span', { style: 'display:none' }, String(props.optionLabel(opt)))
                      : null,
                    slots.option({ option: opt }),
                  ]
                : String(typeof props.optionLabel === 'function' ? props.optionLabel(opt) : label),
            ),
          );
          return [header, ...options];
        }),
      ]);
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
        // Provide hooks to trigger v-model update:visible handlers for coverage.
        h('button', {
          'data-test': 'dialog-update-visible-true',
          onClick: () => emit('update:visible', true),
        }),
        h('button', {
          'data-test': 'dialog-update-visible-false',
          onClick: () => emit('update:visible', false),
        }),
        slots.default?.(),
      ]),
});

describe('AppTopBar global search', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
    navigateToMock.mockReset();
    toastAdd.mockReset();
    getUserMock.mockResolvedValue({ data: { user: { email: 'reader@theseedbed.app' } } } as any);
    supabaseClientRef.current = { auth: { getUser: getUserMock, signOut: signOutMock } };
  });

  it('wires mobile search open/close and mobile include toggle', async () => {
    apiRequestMock.mockResolvedValueOnce({ items: [] }); // library search
    apiRequestMock.mockResolvedValueOnce({ items: [] }); // open library search

    const wrapper = mount(AppTopBar, {
      global: {
        plugins: [[PrimeVue, { ripple: false }]],
        stubs: {
          Menubar: MenubarStub,
          Button: ButtonStub,
          Menu: defineComponent({ name: 'Menu', props: ['model'], setup: () => () => h('div') }),
          NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
          AutoComplete: AutoCompleteStub,
          Dialog: DialogStub,
          ToggleSwitch: ToggleSwitchStub,
        },
      },
    });

    await Promise.resolve();
    await nextTick();

    // Mobile open button should flip the dialog v-model handler.
    expect(wrapper.find('[data-test="navbar-search-open"]').exists()).toBe(true);
    await wrapper.get('[data-test="navbar-search-open"]').trigger('click');

    // Trigger the Dialog v-model update handler (coverage for v-model:visible).
    await wrapper.get('[data-test="dialog-update-visible-true"]').trigger('click');

    // Mobile include toggle should update includeNonLibrary.
    await wrapper.get('[data-test="navbar-search-include-toggle-mobile"]').trigger('click');

    // Search from the mobile AutoComplete should now only query the library.
    await wrapper.get('[data-test="ac-complete"]').trigger('click');
    await nextTick();
    expect(apiRequestMock).toHaveBeenCalledWith('/api/v1/library/search', expect.anything());
    expect(apiRequestMock).not.toHaveBeenCalledWith('/api/v1/books/search', expect.anything());

    // Close button should flip the dialog v-model handler.
    await wrapper.get('[data-test="navbar-search-close"]').trigger('click');
    await wrapper.get('[data-test="dialog-update-visible-false"]').trigger('click');
  });

  it('does not crash if Supabase client is missing', async () => {
    supabaseClientRef.current = null as any;

    const wrapper = mount(AppTopBar, {
      global: {
        plugins: [[PrimeVue, { ripple: false }]],
        stubs: {
          Menubar: MenubarStub,
          Button: ButtonStub,
          Menu: defineComponent({
            name: 'Menu',
            props: ['model'],
            setup: (props) => () =>
              h(
                'div',
                (props.model || []).map((item: any) =>
                  h(
                    'button',
                    {
                      key: item.label,
                      'data-test': `menu-item-${item.label}`,
                      onClick: () => item.command?.(),
                      disabled: Boolean(item.disabled) || Boolean(item.separator),
                    },
                    item.label ?? '',
                  ),
                ),
              ),
          }),
          NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
          AutoComplete: AutoCompleteStub,
          Dialog: DialogStub,
          ToggleSwitch: ToggleSwitchStub,
        },
      },
    });

    await nextTick();
    // No Supabase means onMounted returns early and userEmail remains null, so sign-in CTA should render.
    expect(wrapper.get('[data-test="account-signin"]').exists()).toBe(true);
  });

  it('guards sign out when Supabase client is missing', async () => {
    supabaseClientRef.current = null as any;

    const wrapper = mount(AppTopBar, {
      global: {
        plugins: [[PrimeVue, { ripple: false }]],
        stubs: {
          Menubar: MenubarStub,
          Button: ButtonStub,
          Menu: defineComponent({
            name: 'Menu',
            props: ['model'],
            setup: (props) => () =>
              h(
                'div',
                (props.model || []).map((item: any) =>
                  h(
                    'button',
                    {
                      key: item.label,
                      'data-test': `menu-item-${item.label}`,
                      onClick: () => item.command?.(),
                      disabled: Boolean(item.disabled) || Boolean(item.separator),
                    },
                    item.label ?? '',
                  ),
                ),
              ),
          }),
          NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
          AutoComplete: AutoCompleteStub,
          Dialog: DialogStub,
          ToggleSwitch: ToggleSwitchStub,
        },
      },
    });

    // Force account menu to render and include "Sign out" even though onMounted returned early.
    (wrapper.vm as any).userEmail = 'reader@theseedbed.app';
    await nextTick();

    expect(wrapper.find('[data-test="account-open"]').exists()).toBe(true);

    // The command should no-op due to missing supabase client, rather than throwing.
    await wrapper.get('[data-test="menu-item-Sign out"]').trigger('click');
    expect(navigateToMock).not.toHaveBeenCalledWith('/');
  });

  it('queries library and open library, groups results, and deduplicates', async () => {
    apiRequestMock.mockImplementation(async (path: string) => {
      if (path === '/api/v1/library/search') {
        return {
          items: [
            {
              work_id: 'work-1',
              work_title: 'Hatchet',
              author_names: ['Gary Paulsen'],
              cover_url: 'https://example.com/hatchet.jpg',
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
              cover_url: null,
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

    const wrapper = mount(AppTopBar, {
      global: {
        plugins: [[PrimeVue, { ripple: false }]],
        stubs: {
          Menubar: MenubarStub,
          Button: ButtonStub,
          Menu: defineComponent({ name: 'Menu', props: ['model'], setup: () => () => h('div') }),
          NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
          AutoComplete: AutoCompleteStub,
          Dialog: DialogStub,
          ToggleSwitch: ToggleSwitchStub,
        },
      },
    });

    // Wait for userEmail to be set.
    await Promise.resolve();
    await nextTick();

    await wrapper.get('[data-test="ac-complete"]').trigger('click');
    await nextTick();

    expect(apiRequestMock).toHaveBeenCalledWith('/api/v1/library/search', expect.anything());
    expect(apiRequestMock).toHaveBeenCalledWith('/api/v1/books/search', expect.anything());

    // Should render group headers via slots in AppTopBar.
    expect(wrapper.find('[data-test="navbar-search-group-in-your-library"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="navbar-search-group-add-to-library"]').exists()).toBe(true);

    // Dedup excludes OL1W from open-library results, leaving OL2W.
    expect(wrapper.find('[data-test="ac-option-openlibrary-/works/OL1W"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="ac-option-openlibrary-/works/OL2W"]').exists()).toBe(true);
  });

  it('ignores stale search responses and only shows the latest query results', async () => {
    // eslint-disable-next-line no-unused-vars -- param name in function type triggers this rule in this repo.
    let resolveFirst: ((payload: any) => void) | null = null;
    const firstLibraryPromise = new Promise((resolve) => {
      resolveFirst = resolve;
    });

    apiRequestMock.mockImplementation(async (path: string, opts?: any) => {
      if (path === '/api/v1/library/search') {
        const q = opts?.query?.query;
        if (q === 'ha') {
          return await firstLibraryPromise;
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
      if (path === '/api/v1/books/search') {
        return { items: [] };
      }
      throw new Error(`unexpected call: ${path}`);
    });

    const wrapper = mount(AppTopBar, {
      global: {
        plugins: [[PrimeVue, { ripple: false }]],
        stubs: {
          Menubar: MenubarStub,
          Button: ButtonStub,
          Menu: defineComponent({ name: 'Menu', props: ['model'], setup: () => () => h('div') }),
          NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
          AutoComplete: AutoCompleteStub,
          Dialog: DialogStub,
          ToggleSwitch: ToggleSwitchStub,
        },
      },
    });

    await Promise.resolve();
    await nextTick();

    // Start first query ("ha") and do not resolve it yet.
    await wrapper.get('[data-test="ac-complete"]').trigger('click');
    await nextTick();

    // Start second query ("hat") which resolves immediately with "New Result".
    await wrapper.get('[data-test="ac-complete-hat"]').trigger('click');
    await nextTick();

    expect(wrapper.find('[data-test="ac-option-library-work-new"]').exists()).toBe(true);

    // Now resolve the first query with "Old Result". It should be ignored.
    resolveFirst?.({
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

    expect(wrapper.find('[data-test="ac-option-library-work-new"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="ac-option-library-work-old"]').exists()).toBe(false);
  });

  it('ignores stale Open Library responses (second request wins)', async () => {
    // eslint-disable-next-line no-unused-vars -- param name in function type triggers this rule in this repo.
    let resolveOldOl: ((value: any) => void) | null = null;
    const oldOlPromise = new Promise((resolve) => {
      resolveOldOl = resolve;
    });

    apiRequestMock.mockImplementation(async (path: string, opts?: any) => {
      const q = opts?.query?.query;

      if (path === '/api/v1/library/search') {
        return { items: [] };
      }
      if (path === '/api/v1/books/search') {
        // Keep the first Open Library search pending; resolve it after the second query completes.
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

    const wrapper = mount(AppTopBar, {
      global: {
        plugins: [[PrimeVue, { ripple: false }]],
        stubs: {
          Menubar: MenubarStub,
          Button: ButtonStub,
          Menu: defineComponent({ name: 'Menu', props: ['model'], setup: () => () => h('div') }),
          NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
          AutoComplete: AutoCompleteStub,
          Dialog: DialogStub,
          ToggleSwitch: ToggleSwitchStub,
        },
      },
    });

    await Promise.resolve();
    await nextTick();

    // Start old query ("ha") which will hang on the Open Library call.
    await wrapper.get('[data-test="ac-complete"]').trigger('click');
    await nextTick();

    // Start newer query ("hat") which resolves immediately with empty results.
    await wrapper.get('[data-test="ac-complete-hat"]').trigger('click');
    await nextTick();

    // Now resolve the old Open Library call with a result; it should be ignored.
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

    expect(wrapper.find('[data-test="ac-option-openlibrary-/works/OL-STALE"]').exists()).toBe(
      false,
    );
  });

  it('does not toast for stale search errors', async () => {
    // eslint-disable-next-line no-unused-vars -- param name in function type triggers this rule in this repo.
    let rejectOld: ((err: any) => void) | null = null;
    const oldPromise = new Promise((_, reject) => {
      rejectOld = reject;
    });

    apiRequestMock.mockImplementation(async (path: string, opts?: any) => {
      const q = opts?.query?.query;

      if (path === '/api/v1/library/search') {
        if (q === 'ha') {
          return await oldPromise;
        }
        if (q === 'hat') {
          return { items: [] };
        }
        return { items: [] };
      }
      if (path === '/api/v1/books/search') {
        return { items: [] };
      }
      throw new Error(`unexpected call: ${path}`);
    });

    const wrapper = mount(AppTopBar, {
      global: {
        plugins: [[PrimeVue, { ripple: false }]],
        stubs: {
          Menubar: MenubarStub,
          Button: ButtonStub,
          Menu: defineComponent({ name: 'Menu', props: ['model'], setup: () => () => h('div') }),
          NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
          AutoComplete: AutoCompleteStub,
          Dialog: DialogStub,
          ToggleSwitch: ToggleSwitchStub,
        },
      },
    });

    await Promise.resolve();
    await nextTick();

    await wrapper.get('[data-test="ac-complete"]').trigger('click');
    await nextTick();

    await wrapper.get('[data-test="ac-complete-hat"]').trigger('click');
    await nextTick();

    // Reject the old request after the newer request has completed.
    rejectOld?.(new ApiClientError('Old failed', 'request_failed', 500));
    await nextTick();

    expect(toastAdd).not.toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'error', summary: 'Old failed' }),
    );
  });

  it('selecting a library result navigates', async () => {
    apiRequestMock.mockImplementation(async (path: string) => {
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
        return { items: [] };
      }
      throw new Error(`unexpected call: ${path}`);
    });

    const wrapper = mount(AppTopBar, {
      global: {
        plugins: [[PrimeVue, { ripple: false }]],
        stubs: {
          Menubar: MenubarStub,
          Button: ButtonStub,
          Menu: defineComponent({ name: 'Menu', props: ['model'], setup: () => () => h('div') }),
          NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
          AutoComplete: AutoCompleteStub,
          Dialog: DialogStub,
          ToggleSwitch: ToggleSwitchStub,
        },
      },
    });

    await Promise.resolve();
    await nextTick();

    await wrapper.get('[data-test="ac-complete"]').trigger('click');
    await nextTick();

    await wrapper.get('[data-test="ac-option-library-work-1"]').trigger('click');
    await nextTick();

    expect(navigateToMock).toHaveBeenCalledWith('/books/work-1');
  });

  it('does not call open library when toggle is off', async () => {
    apiRequestMock.mockResolvedValue({ items: [] });

    const wrapper = mount(AppTopBar, {
      global: {
        plugins: [[PrimeVue, { ripple: false }]],
        stubs: {
          Menubar: MenubarStub,
          Button: ButtonStub,
          Menu: defineComponent({ name: 'Menu', props: ['model'], setup: () => () => h('div') }),
          NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
          AutoComplete: AutoCompleteStub,
          Dialog: DialogStub,
          ToggleSwitch: ToggleSwitchStub,
        },
      },
    });

    await Promise.resolve();
    await nextTick();

    await wrapper.get('[data-test="navbar-search-include-toggle"]').trigger('click'); // off
    await wrapper.get('[data-test="ac-complete"]').trigger('click');
    await nextTick();

    const paths = apiRequestMock.mock.calls.map((call) => call[0]);
    expect(paths).toContain('/api/v1/library/search');
    expect(paths).not.toContain('/api/v1/books/search');
  });

  it('selecting an open library result asks for confirmation before importing/adding', async () => {
    apiRequestMock.mockImplementation(async (path: string) => {
      if (path === '/api/v1/library/search') {
        return { items: [] };
      }
      if (path === '/api/v1/books/search') {
        return {
          items: [
            {
              work_key: '/works/OL9W',
              title: 'Hello',
              author_names: ['World'],
              first_publish_year: 2020,
              cover_url: null,
            },
          ],
        };
      }
      if (path === '/api/v1/books/import') {
        return { work: { id: 'work-imported' } };
      }
      if (path === '/api/v1/library/items') {
        return { created: true };
      }
      throw new Error(`unexpected call: ${path}`);
    });

    const wrapper = mount(AppTopBar, {
      global: {
        plugins: [[PrimeVue, { ripple: false }]],
        stubs: {
          Menubar: MenubarStub,
          Button: ButtonStub,
          Menu: defineComponent({ name: 'Menu', props: ['model'], setup: () => () => h('div') }),
          NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
          AutoComplete: AutoCompleteStub,
          Dialog: DialogStub,
          ToggleSwitch: ToggleSwitchStub,
        },
      },
    });

    await Promise.resolve();
    await nextTick();

    await wrapper.get('[data-test="ac-complete"]').trigger('click');
    await nextTick();

    await wrapper.get('[data-test="ac-option-openlibrary-/works/OL9W"]').trigger('click');
    await nextTick();

    // Should not auto-add. Must confirm.
    expect(apiRequestMock).not.toHaveBeenCalledWith('/api/v1/books/import', expect.anything());
    expect(wrapper.find('[data-test="navbar-search-add-dialog"]').exists()).toBe(true);

    await wrapper.get('[data-test="navbar-search-add-confirm"]').trigger('click');
    await nextTick();

    expect(apiRequestMock).toHaveBeenCalledWith('/api/v1/books/import', expect.anything());
    expect(apiRequestMock).toHaveBeenCalledWith('/api/v1/library/items', expect.anything());
    expect(navigateToMock).toHaveBeenCalledWith('/books/work-imported');
  });

  it('canceling add confirmation clears the pending selection and does not import', async () => {
    apiRequestMock.mockImplementation(async (path: string) => {
      if (path === '/api/v1/library/search') {
        return { items: [] };
      }
      if (path === '/api/v1/books/search') {
        return {
          items: [
            {
              work_key: '/works/OL11W',
              title: 'Cancel Me',
              author_names: ['Tester'],
              first_publish_year: 2020,
              cover_url: null,
            },
          ],
        };
      }
      throw new Error(`unexpected call: ${path}`);
    });

    const wrapper = mount(AppTopBar, {
      global: {
        plugins: [[PrimeVue, { ripple: false }]],
        stubs: {
          Menubar: MenubarStub,
          Button: ButtonStub,
          Menu: defineComponent({ name: 'Menu', props: ['model'], setup: () => () => h('div') }),
          NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
          AutoComplete: AutoCompleteStub,
          Dialog: DialogStub,
          ToggleSwitch: ToggleSwitchStub,
        },
      },
    });

    await Promise.resolve();
    await nextTick();

    await wrapper.get('[data-test="ac-complete"]').trigger('click');
    await nextTick();

    await wrapper.get('[data-test="ac-option-openlibrary-/works/OL11W"]').trigger('click');
    await nextTick();

    expect(wrapper.find('[data-test="navbar-search-add-dialog"]').exists()).toBe(true);

    await wrapper.get('[data-test="navbar-search-add-cancel"]').trigger('click');
    await nextTick();

    // After cancel, clicking confirm should early-return (pendingAdd was cleared).
    await wrapper.get('[data-test="navbar-search-add-confirm"]').trigger('click');
    await nextTick();

    expect(apiRequestMock).not.toHaveBeenCalledWith('/api/v1/books/import', expect.anything());
    expect(navigateToMock).not.toHaveBeenCalledWith(expect.stringMatching(/\/books\//));
  });

  it('shows toast on search error', async () => {
    apiRequestMock.mockRejectedValueOnce(new ApiClientError('Nope', 'request_failed', 500));

    const wrapper = mount(AppTopBar, {
      global: {
        plugins: [[PrimeVue, { ripple: false }]],
        stubs: {
          Menubar: MenubarStub,
          Button: ButtonStub,
          Menu: defineComponent({ name: 'Menu', props: ['model'], setup: () => () => h('div') }),
          NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
          AutoComplete: AutoCompleteStub,
          Dialog: DialogStub,
          ToggleSwitch: ToggleSwitchStub,
        },
      },
    });

    await Promise.resolve();
    await nextTick();

    await wrapper.get('[data-test="ac-complete"]').trigger('click');
    await nextTick();

    expect(toastAdd).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'error', summary: 'Nope' }),
    );
  });

  it('ignores queries shorter than 2 characters', async () => {
    const wrapper = mount(AppTopBar, {
      global: {
        plugins: [[PrimeVue, { ripple: false }]],
        stubs: {
          Menubar: MenubarStub,
          Button: ButtonStub,
          Menu: defineComponent({ name: 'Menu', props: ['model'], setup: () => () => h('div') }),
          NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
          AutoComplete: AutoCompleteStub,
          Dialog: DialogStub,
          ToggleSwitch: ToggleSwitchStub,
        },
      },
    });

    await Promise.resolve();
    await nextTick();

    await wrapper.get('[data-test="ac-complete-short"]').trigger('click');
    await nextTick();

    expect(apiRequestMock).not.toHaveBeenCalled();
  });

  it('shows toast on add-to-library error', async () => {
    apiRequestMock.mockImplementation(async (path: string) => {
      if (path === '/api/v1/library/search') {
        return { items: [] };
      }
      if (path === '/api/v1/books/search') {
        return {
          items: [
            {
              work_key: '/works/OL10W',
              title: 'Boom',
              author_names: [],
              first_publish_year: 2020,
              cover_url: null,
            },
          ],
        };
      }
      if (path === '/api/v1/books/import') {
        throw new ApiClientError('Import failed', 'request_failed', 502);
      }
      throw new Error(`unexpected call: ${path}`);
    });

    const wrapper = mount(AppTopBar, {
      global: {
        plugins: [[PrimeVue, { ripple: false }]],
        stubs: {
          Menubar: MenubarStub,
          Button: ButtonStub,
          Menu: defineComponent({ name: 'Menu', props: ['model'], setup: () => () => h('div') }),
          NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
          AutoComplete: AutoCompleteStub,
          Dialog: DialogStub,
          ToggleSwitch: ToggleSwitchStub,
        },
      },
    });

    await Promise.resolve();
    await nextTick();

    await wrapper.get('[data-test="ac-complete"]').trigger('click');
    await nextTick();

    await wrapper.get('[data-test="ac-option-openlibrary-/works/OL10W"]').trigger('click');
    await nextTick();

    await wrapper.get('[data-test="navbar-search-add-confirm"]').trigger('click');
    await nextTick();

    expect(toastAdd).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'error', summary: 'Import failed' }),
    );
    expect(navigateToMock).not.toHaveBeenCalledWith('/books/work-imported');
  });
});
