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

const authReadyRef = vi.hoisted(() => {
  const { ref } = require('vue');
  return ref<boolean>(true);
});

vi.mock('#imports', () => ({
  useRoute: () => routeState,
  useState: (key: string, init: () => any) => {
    const { ref } = require('vue');
    if (key === 'auth:ready') return authReadyRef;
    return ref(init());
  },
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

  it('renders app layout shell without the left nav section', async () => {
    authReadyRef.value = true;
    routeState.path = '/library';

    const wrapper = mount(AppLayout as any, {
      slots: { default: SlotContent },
      global: {
        stubs: {
          AppTopBar: { template: '<div data-test="topbar" />' },
          AppBreadcrumbs: { template: '<div data-test="crumbs" />' },
          NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
        },
      },
    });

    expect(wrapper.get('[data-test="topbar"]').exists()).toBe(true);
    expect(wrapper.get('[data-test="crumbs"]').exists()).toBe(true);
    expect(wrapper.get('[data-test="slot"]').exists()).toBe(true);
    expect(wrapper.get('main').classes()).toContain('max-w-none');

    routeState.path = '/books/search';
    await wrapper.vm.$nextTick();
    expect(wrapper.get('main').classes()).toContain('max-w-6xl');
  });

  it('shows an auth bootstrap loading state while auth is unknown', () => {
    authReadyRef.value = false;

    const wrapper = mount(AppLayout as any, {
      slots: { default: SlotContent },
      global: {
        stubs: {
          AppTopBar: { template: '<div data-test="topbar" />' },
          AppBreadcrumbs: { template: '<div data-test="crumbs" />' },
        },
      },
    });

    expect(wrapper.get('[data-test="auth-bootstrap-loading"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="slot"]').exists()).toBe(false);
  });
});
