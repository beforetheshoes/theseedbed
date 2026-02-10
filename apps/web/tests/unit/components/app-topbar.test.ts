import { describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { mount } from '@vue/test-utils';
import PrimeVue from 'primevue/config';

const toastAdd = vi.hoisted(() => vi.fn());
const navigateToMock = vi.hoisted(() => vi.fn());
const getUserMock = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ data: { user: { email: 'reader@theseedbed.app' } } }),
);
const signOutMock = vi.hoisted(() => vi.fn().mockResolvedValue({}));
const colorModeRef = vi.hoisted(() => {
  const { ref } = require('vue');
  return ref<'light' | 'dark' | 'system'>('system');
});
const setModeMock = vi.hoisted(() => vi.fn());

vi.mock('#imports', () => ({
  useSupabaseClient: () => ({ auth: { getUser: getUserMock, signOut: signOutMock } }),
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

import AppTopBar from '../../../app/components/shell/AppTopBar.vue';

describe('AppTopBar', () => {
  it('wires color mode commands and sign out flow', async () => {
    colorModeRef.value = 'system';
    const menuToggles: Array<unknown> = [];

    const MenuStub = defineComponent({
      name: 'Menu',
      props: ['model'],
      setup: (props, { expose }) => {
        const toggle = vi.fn();
        expose({ toggle });
        menuToggles.push(toggle);

        return () =>
          h(
            'div',
            { 'data-test': 'menu' },
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
          );
      },
    });

    const wrapper = mount(AppTopBar, {
      props: { showSidebarToggle: true },
      global: {
        plugins: [[PrimeVue, { ripple: false }]],
        stubs: {
          AutoComplete: defineComponent({
            name: 'AutoComplete',
            setup:
              (_props, { attrs }) =>
              () =>
                h('div', { ...attrs }),
          }),
          Dialog: defineComponent({
            name: 'Dialog',
            setup:
              (_props, { slots, attrs }) =>
              () =>
                h('div', { ...attrs }, slots.default?.()),
          }),
          ToggleSwitch: defineComponent({
            name: 'ToggleSwitch',
            setup:
              (_props, { attrs }) =>
              () =>
                h('div', { ...attrs }),
          }),
          Menu: MenuStub,
          SelectButton: defineComponent({
            name: 'SelectButton',
            props: ['modelValue', 'options', 'optionLabel', 'optionValue'],
            emits: ['update:modelValue'],
            inheritAttrs: false,
            setup: (props, { attrs, emit, slots }) => {
              const getLabel = (opt: any) =>
                props.optionLabel ? opt[props.optionLabel] : String(opt);
              const getValue = (opt: any) => (props.optionValue ? opt[props.optionValue] : opt);

              return () =>
                h(
                  'div',
                  { ...attrs },
                  (props.options || []).map((opt: any) =>
                    h(
                      'button',
                      {
                        key: getValue(opt),
                        'data-test': `select-${getValue(opt)}`,
                        onClick: () => emit('update:modelValue', getValue(opt)),
                      },
                      slots.option ? slots.option({ option: opt }) : getLabel(opt),
                    ),
                  ),
                );
            },
          }),
          Toolbar: defineComponent({
            name: 'Toolbar',
            setup:
              (_props, { slots }) =>
              () =>
                h('div', [slots.start?.(), slots.end?.()]),
          }),
          NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
          Button: defineComponent({
            name: 'Button',
            emits: ['click'],
            setup:
              (_props, { slots, emit }) =>
              () =>
                h(
                  'button',
                  { onClick: (e: any) => emit('click', e) },
                  slots.default?.({ class: 'p-button' }),
                ),
          }),
        },
      },
    });

    // Exercise template ternaries for variant selection (outlined vs text) on all three controls.
    colorModeRef.value = 'dark';
    await wrapper.vm.$nextTick();
    colorModeRef.value = 'light';
    await wrapper.vm.$nextTick();
    colorModeRef.value = 'system';
    await wrapper.vm.$nextTick();

    // Selecting a color mode updates the v-model.
    await wrapper.get('[data-test="color-mode-dark"]').trigger('click');
    expect(setModeMock).toHaveBeenCalledWith('dark');
    expect(toastAdd).toHaveBeenCalled();

    await wrapper.get('[data-test="color-mode-system"]').trigger('click');
    expect(setModeMock).toHaveBeenCalledWith('system');
    expect(toastAdd).toHaveBeenCalled();

    await wrapper.get('[data-test="color-mode-light"]').trigger('click');
    expect(setModeMock).toHaveBeenCalledWith('light');
    expect(toastAdd).toHaveBeenCalled();

    // Mobile theme menu toggle (separate Menu instance) should be wired.
    await wrapper.get('[data-test="color-mode-menu"]').trigger('click');
    expect(menuToggles.length).toBeGreaterThanOrEqual(2);
    expect((menuToggles[0] as any).mock.calls.length).toBeGreaterThan(0);

    // Color menu items should call through to setAndToast.
    await wrapper.get('[data-test="menu-item-Dark"]').trigger('click');
    expect(setModeMock).toHaveBeenCalledWith('dark');
    await wrapper.get('[data-test="menu-item-Light"]').trigger('click');
    expect(setModeMock).toHaveBeenCalledWith('light');
    await wrapper.get('[data-test="menu-item-System"]').trigger('click');
    expect(setModeMock).toHaveBeenCalledWith('system');

    // Mobile nav button emits toggleSidebar.
    await wrapper.get('[data-test="app-nav-open"]').trigger('click');
    expect(wrapper.emitted('toggleSidebar')).toBeTruthy();

    // Brand/home button uses navigateTo.
    await wrapper.get('[data-test="topbar-home"]').trigger('click');
    expect(navigateToMock).toHaveBeenCalledWith('/');

    // Signed-in users should get account button after getUser resolves.
    await Promise.resolve();
    expect(getUserMock).toHaveBeenCalled();
    expect(wrapper.get('[data-test="account-open"]').exists()).toBe(true);

    await wrapper.get('[data-test="account-open"]').trigger('click');
    // The top bar contains two Menu popups: theme (first) and account (second).
    expect(menuToggles.length).toBeGreaterThanOrEqual(2);
    expect((menuToggles[1] as any).mock.calls.length).toBeGreaterThan(0);

    // Click sign out command.
    await wrapper.get('[data-test="menu-item-Sign out"]').trigger('click');
    expect(signOutMock).toHaveBeenCalled();
    expect(navigateToMock).toHaveBeenCalledWith('/');
  });

  it('renders sign-in CTA when user email is missing', async () => {
    getUserMock.mockResolvedValueOnce({ data: { user: null } } as any);

    const wrapper = mount(AppTopBar, {
      global: {
        plugins: [[PrimeVue, { ripple: false }]],
        stubs: {
          AutoComplete: defineComponent({
            name: 'AutoComplete',
            setup:
              (_props, { attrs }) =>
              () =>
                h('div', { ...attrs }),
          }),
          Dialog: defineComponent({
            name: 'Dialog',
            setup:
              (_props, { slots, attrs }) =>
              () =>
                h('div', { ...attrs }, slots.default?.()),
          }),
          ToggleSwitch: defineComponent({
            name: 'ToggleSwitch',
            setup:
              (_props, { attrs }) =>
              () =>
                h('div', { ...attrs }),
          }),
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
          Toolbar: defineComponent({
            name: 'Toolbar',
            setup:
              (_props, { slots }) =>
              () =>
                h('div', [slots.start?.(), slots.end?.()]),
          }),
          NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
          Button: defineComponent({
            name: 'Button',
            emits: ['click'],
            setup:
              (_props, { slots, emit }) =>
              () =>
                h(
                  'button',
                  { onClick: (e: any) => emit('click', e) },
                  slots.default?.({ class: 'p-button' }),
                ),
          }),
        },
      },
    });

    await Promise.resolve();
    expect(wrapper.get('[data-test="account-signin"]').exists()).toBe(true);

    await wrapper.get('[data-test="menu-item-Sign in"]').trigger('click');
    expect(navigateToMock).toHaveBeenCalledWith('/login');
  });
});
