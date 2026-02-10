import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent } from 'vue';
import { vi } from 'vitest';

import AppLayout from '../../../app/layouts/app.vue';
import AuthLayout from '../../../app/layouts/auth.vue';
import MarketingLayout from '../../../app/layouts/marketing.vue';
import PublicLayout from '../../../app/layouts/public.vue';

const routeState = vi.hoisted(() => {
  const { reactive } = require('vue');
  return reactive({ path: '/library' });
});

vi.mock('#imports', () => ({
  useRoute: () => routeState,
}));

const SlotContent = defineComponent({
  template: '<div data-test="slot">slot</div>',
});

describe('layouts', () => {
  it('renders marketing/auth/public layouts with slot', () => {
    for (const Layout of [MarketingLayout, AuthLayout, PublicLayout]) {
      const wrapper = mount(Layout as any, {
        slots: { default: SlotContent },
        global: { stubs: { AppTopBar: { template: '<div data-test="topbar" />' } } },
      });

      expect(wrapper.get('[data-test="topbar"]').exists()).toBe(true);
      expect(wrapper.get('[data-test="slot"]').exists()).toBe(true);
    }
  });

  it('renders app layout and includes the sidebar shell components', async () => {
    const AppSidebarStub = defineComponent({
      name: 'AppSidebar',
      props: ['visible'],
      emits: ['update:visible'],
      template: '<div data-test="sidebar">visible={{ visible }}</div>',
    });

    const wrapper = mount(AppLayout as any, {
      slots: { default: SlotContent },
      global: {
        stubs: {
          AppTopBar: {
            template: '<button data-test="topbar" @click="$emit(\'toggleSidebar\')"></button>',
          },
          AppSidebar: AppSidebarStub,
          AppBreadcrumbs: { template: '<div data-test="crumbs" />' },
          AppNavMenu: { template: '<div data-test="navmenu" />' },
          NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
          Button: { template: '<div><slot :class="`p-button`" /></div>' },
          Card: { template: '<div data-test="card"><slot name="content" /></div>' },
        },
      },
    });

    expect(wrapper.get('[data-test="topbar"]').exists()).toBe(true);
    expect(wrapper.get('[data-test="sidebar"]').exists()).toBe(true);
    expect(wrapper.get('[data-test="crumbs"]').exists()).toBe(true);
    expect(wrapper.get('[data-test="navmenu"]').exists()).toBe(true);
    expect(wrapper.get('[data-test="slot"]').exists()).toBe(true);

    expect(wrapper.get('[data-test="sidebar"]').text()).toContain('visible=false');
    await wrapper.get('[data-test="topbar"]').trigger('click');
    await wrapper.vm.$nextTick();
    expect(wrapper.get('[data-test="sidebar"]').text()).toContain('visible=true');

    // Exercise the v-model update handler in the layout.
    wrapper.findComponent(AppSidebarStub).vm.$emit('update:visible', false);
    await wrapper.vm.$nextTick();
    expect(wrapper.get('[data-test="sidebar"]').text()).toContain('visible=false');
  });
});
