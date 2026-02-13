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

const supabaseClientRef = vi.hoisted(() => ({
  current: { auth: { getUser: getUserMock, signOut: signOutMock } } as any,
}));
const colorModeRef = vi.hoisted(() => {
  const { ref } = require('vue');
  return ref<'light' | 'dark' | 'system'>('system');
});
const setModeMock = vi.hoisted(() => vi.fn());
const menuState = vi.hoisted(() => ({
  toggles: [] as Array<ReturnType<typeof vi.fn>>,
}));

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
      setMode: (value: any) => {
        colorModeRef.value = value;
        setModeMock(value);
      },
    }),
  };
});

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

const MenuStub = defineComponent({
  name: 'Menu',
  props: ['model'],
  setup: (props, { attrs, expose }) => {
    const toggle = vi.fn();
    menuState.toggles.push(toggle);
    expose({ toggle });

    return () =>
      h(
        'div',
        { ...attrs },
        (props.model || []).flatMap((item: any) => {
          if (item?.separator) {
            return [];
          }
          return [
            h(
              'button',
              {
                key: item?.label,
                'data-test': `menu-item-${item?.label}`,
                onClick: () => item?.command?.(),
                disabled: Boolean(item?.disabled),
              },
              item?.label ?? '',
            ),
          ];
        }),
      );
  },
});

describe('AppTopBar', () => {
  beforeEach(() => {
    toastAdd.mockReset();
    navigateToMock.mockReset();
    getUserMock.mockResolvedValue({ data: { user: { email: 'reader@theseedbed.app' } } } as any);
    supabaseClientRef.current = { auth: { getUser: getUserMock, signOut: signOutMock } };
    menuState.toggles.length = 0;
  });

  it('navigates home from the logo button', async () => {
    const wrapper = mount(AppTopBar, {
      global: {
        plugins: [[PrimeVue, { ripple: false }]],
        stubs: {
          Menubar: MenubarStub,
          Button: ButtonStub,
          Menu: MenuStub,
          NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
          AppTopBarBookSearch: defineComponent({
            name: 'AppTopBarBookSearch',
            setup: () => () => h('div'),
          }),
        },
      },
    });

    await wrapper.get('[data-test="topbar-home"]').trigger('click');
    expect(navigateToMock).toHaveBeenCalledWith('/');
  });

  it('updates color mode and toasts on theme button clicks', async () => {
    const wrapper = mount(AppTopBar, {
      global: {
        plugins: [[PrimeVue, { ripple: false }]],
        stubs: {
          Menubar: MenubarStub,
          Button: ButtonStub,
          Menu: MenuStub,
          NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
          AppTopBarBookSearch: defineComponent({
            name: 'AppTopBarBookSearch',
            setup: () => () => h('div'),
          }),
        },
      },
    });

    await wrapper.get('[data-test="color-mode-light"]').trigger('click');
    expect(setModeMock).toHaveBeenCalledWith('light');
    expect(toastAdd).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'info', summary: 'Theme updated' }),
    );

    await wrapper.get('[data-test="color-mode-system"]').trigger('click');
    expect(setModeMock).toHaveBeenCalledWith('system');

    await wrapper.get('[data-test="color-mode-dark"]').trigger('click');
    expect(setModeMock).toHaveBeenCalledWith('dark');
  });

  it('toggles the color and account menus', async () => {
    const wrapper = mount(AppTopBar, {
      global: {
        plugins: [[PrimeVue, { ripple: false }]],
        stubs: {
          Menubar: MenubarStub,
          Button: ButtonStub,
          Menu: MenuStub,
          NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
          AppTopBarBookSearch: defineComponent({
            name: 'AppTopBarBookSearch',
            setup: () => () => h('div'),
          }),
        },
      },
    });

    // Wait for userEmail to be set so account button appears.
    await Promise.resolve();
    await nextTick();

    expect(menuState.toggles.length).toBe(2);

    await wrapper.get('[data-test="color-mode-menu"]').trigger('click');
    expect(menuState.toggles[0]).toHaveBeenCalled();

    await wrapper.get('[data-test="account-open"]').trigger('click');
    expect(menuState.toggles[1]).toHaveBeenCalled();
  });

  it('executes sign-out from the account menu when authed', async () => {
    const wrapper = mount(AppTopBar, {
      global: {
        plugins: [[PrimeVue, { ripple: false }]],
        stubs: {
          Menubar: MenubarStub,
          Button: ButtonStub,
          Menu: MenuStub,
          NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
          AppTopBarBookSearch: defineComponent({
            name: 'AppTopBarBookSearch',
            setup: () => () => h('div'),
          }),
        },
      },
    });

    await Promise.resolve();
    await nextTick();

    await wrapper.get('[data-test="menu-item-Sign out"]').trigger('click');
    await Promise.resolve();
    await nextTick();

    expect(signOutMock).toHaveBeenCalled();
    expect(toastAdd).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'success', summary: 'Signed out' }),
    );
    expect(navigateToMock).toHaveBeenCalledWith('/');
  });

  it('navigates to settings from the account menu when authed', async () => {
    const wrapper = mount(AppTopBar, {
      global: {
        plugins: [[PrimeVue, { ripple: false }]],
        stubs: {
          Menubar: MenubarStub,
          Button: ButtonStub,
          Menu: MenuStub,
          NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
          AppTopBarBookSearch: defineComponent({
            name: 'AppTopBarBookSearch',
            setup: () => () => h('div'),
          }),
        },
      },
    });

    await Promise.resolve();
    await nextTick();
    await wrapper.get('[data-test="menu-item-Settings"]').trigger('click');

    expect(navigateToMock).toHaveBeenCalledWith('/settings');
  });

  it('executes sign-in navigation from the account menu when not authed', async () => {
    getUserMock.mockResolvedValueOnce({ data: { user: null } } as any);

    const wrapper = mount(AppTopBar, {
      global: {
        plugins: [[PrimeVue, { ripple: false }]],
        stubs: {
          Menubar: MenubarStub,
          Button: ButtonStub,
          Menu: MenuStub,
          NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
          AppTopBarBookSearch: defineComponent({
            name: 'AppTopBarBookSearch',
            setup: () => () => h('div'),
          }),
        },
      },
    });

    await Promise.resolve();
    await nextTick();

    expect(wrapper.get('[data-test="account-signin"]').exists()).toBe(true);
    await wrapper.get('[data-test="menu-item-Sign in"]').trigger('click');
    expect(navigateToMock).toHaveBeenCalledWith('/login');
  });

  it('emits toggleSidebar when the mobile nav button is clicked', async () => {
    const wrapper = mount(AppTopBar, {
      props: { showSidebarToggle: true },
      global: {
        plugins: [[PrimeVue, { ripple: false }]],
        stubs: {
          Menubar: MenubarStub,
          Button: ButtonStub,
          Menu: MenuStub,
          NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
          AppTopBarBookSearch: defineComponent({
            name: 'AppTopBarBookSearch',
            setup: () => () => h('div'),
          }),
        },
      },
    });

    await wrapper.get('[data-test="app-nav-open"]').trigger('click');
    expect(wrapper.emitted('toggleSidebar')).toBeTruthy();
  });

  it('color mode menu items execute their commands', async () => {
    const wrapper = mount(AppTopBar, {
      global: {
        plugins: [[PrimeVue, { ripple: false }]],
        stubs: {
          Menubar: MenubarStub,
          Button: ButtonStub,
          Menu: MenuStub,
          NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
          AppTopBarBookSearch: defineComponent({
            name: 'AppTopBarBookSearch',
            setup: () => () => h('div'),
          }),
        },
      },
    });

    await wrapper.get('[data-test="menu-item-Light"]').trigger('click');
    expect(setModeMock).toHaveBeenCalledWith('light');

    await wrapper.get('[data-test="menu-item-Dark"]').trigger('click');
    expect(setModeMock).toHaveBeenCalledWith('dark');

    await wrapper.get('[data-test="menu-item-System"]').trigger('click');
    expect(setModeMock).toHaveBeenCalledWith('system');
  });

  it('does not crash if Supabase client is missing', async () => {
    supabaseClientRef.current = null as any;

    const wrapper = mount(AppTopBar, {
      global: {
        plugins: [[PrimeVue, { ripple: false }]],
        stubs: {
          Menubar: MenubarStub,
          Button: ButtonStub,
          Menu: MenuStub,
          NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
          AppTopBarBookSearch: defineComponent({
            name: 'AppTopBarBookSearch',
            setup: () => () => h('div'),
          }),
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
          Menu: MenuStub,
          NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
          AppTopBarBookSearch: defineComponent({
            name: 'AppTopBarBookSearch',
            setup: () => () => h('div'),
          }),
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
});
