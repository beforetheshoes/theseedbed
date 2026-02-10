import { describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { mount } from '@vue/test-utils';

import AppSidebar from '../../../app/components/shell/AppSidebar.vue';

const navigateToMock = vi.hoisted(() => vi.fn());
vi.mock('#imports', () => ({
  navigateTo: navigateToMock,
}));

describe('AppSidebar', () => {
  it('closes the drawer when a nav item triggers onNavigate', async () => {
    const DrawerStub = defineComponent({
      name: 'Drawer',
      props: ['visible'],
      emits: ['update:visible'],
      setup:
        (_props, { slots }) =>
        () =>
          h('div', [slots.header?.(), slots.default?.()]),
    });

    const AppNavMenuStub = defineComponent({
      name: 'AppNavMenu',
      props: ['onNavigate'],
      setup: (props) => () =>
        h(
          'button',
          {
            'data-test': 'nav-trigger',
            onClick: () => (props as any).onNavigate?.(),
          },
          'nav',
        ),
    });

    const wrapper = mount(AppSidebar, {
      props: { visible: true },
      global: {
        stubs: {
          Drawer: DrawerStub,
          AppNavMenu: AppNavMenuStub,
          Button: defineComponent({
            name: 'Button',
            inheritAttrs: false,
            emits: ['click'],
            setup:
              (_props, { attrs, slots, emit }) =>
              () =>
                h('button', { ...attrs, onClick: (e: any) => emit('click', e) }, slots.default?.()),
          }),
          NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
        },
      },
    });

    await wrapper.get('[data-test="nav-trigger"]').trigger('click');
    expect(wrapper.emitted('update:visible')?.[0]).toEqual([false]);
  });

  it('navigates home and closes when header brand is clicked', async () => {
    const DrawerStub = defineComponent({
      name: 'Drawer',
      props: ['visible'],
      emits: ['update:visible'],
      setup:
        (_props, { slots }) =>
        () =>
          h('div', [slots.header?.(), slots.default?.()]),
    });

    const wrapper = mount(AppSidebar, {
      props: { visible: true },
      global: {
        stubs: {
          Drawer: DrawerStub,
          AppNavMenu: defineComponent({ name: 'AppNavMenu', template: '<div />' }),
          Button: defineComponent({
            name: 'Button',
            inheritAttrs: false,
            emits: ['click'],
            setup:
              (_props, { attrs, slots, emit }) =>
              () =>
                h('button', { ...attrs, onClick: (e: any) => emit('click', e) }, slots.default?.()),
          }),
        },
      },
    });

    await wrapper.get('[data-test="drawer-home"]').trigger('click');
    expect(navigateToMock).toHaveBeenCalledWith('/');
    expect(wrapper.emitted('update:visible')?.[0]).toEqual([false]);
  });

  it('forwards v-model updates from Drawer', async () => {
    const DrawerStub = defineComponent({
      name: 'Drawer',
      props: ['visible'],
      emits: ['update:visible'],
      setup:
        (props, { emit, slots }) =>
        () =>
          h('div', [
            h(
              'button',
              {
                'data-test': 'drawer-close',
                onClick: () => emit('update:visible', false),
              },
              `visible=${String((props as any).visible)}`,
            ),
            slots.header?.(),
            slots.default?.(),
          ]),
    });

    const wrapper = mount(AppSidebar, {
      props: { visible: true },
      global: {
        stubs: {
          Drawer: DrawerStub,
          AppNavMenu: defineComponent({ name: 'AppNavMenu', template: '<div />' }),
          Button: defineComponent({
            name: 'Button',
            inheritAttrs: false,
            emits: ['click'],
            setup:
              (_props, { attrs, slots, emit }) =>
              () =>
                h('button', { ...attrs, onClick: (e: any) => emit('click', e) }, slots.default?.()),
          }),
          NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
        },
      },
    });

    await wrapper.get('[data-test="drawer-close"]').trigger('click');
    expect(wrapper.emitted('update:visible')?.[0]).toEqual([false]);
  });
});
