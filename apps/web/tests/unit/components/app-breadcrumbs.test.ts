import { describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { mount } from '@vue/test-utils';

const routeState = vi.hoisted(() => {
  const { reactive } = require('vue');
  return reactive({ path: '/books/search' });
});

vi.mock('#imports', () => ({
  useRoute: () => routeState,
}));

import AppBreadcrumbs from '../../../app/components/shell/AppBreadcrumbs.vue';

describe('AppBreadcrumbs', () => {
  it('builds crumbs for common routes', async () => {
    const BreadcrumbStub = defineComponent({
      name: 'Breadcrumb',
      props: ['home', 'model'],
      setup: (props) => () =>
        h(
          'div',
          { 'data-test': 'crumbs' },
          `${(props.home as any)?.to ?? ''} | ${(props.model || []).map((i: any) => i.label).join(' / ')}`,
        ),
    });

    const wrapper = mount(AppBreadcrumbs, {
      global: {
        stubs: { Breadcrumb: BreadcrumbStub },
      },
    });

    routeState.path = '/library';
    await wrapper.vm.$nextTick();
    expect(wrapper.get('[data-test="crumbs"]').text()).toContain('Library');

    routeState.path = '/books/search';
    await wrapper.vm.$nextTick();
    expect(wrapper.get('[data-test="crumbs"]').text()).toContain('Add books');

    routeState.path = '/books/work-1';
    await wrapper.vm.$nextTick();
    expect(wrapper.get('[data-test="crumbs"]').text()).toContain('Book');

    routeState.path = '/unknown';
    await wrapper.vm.$nextTick();
    // Ensure home computed executes by asserting it passes through.
    expect(wrapper.get('[data-test="crumbs"]').text()).toContain('/library');

    // Cover the `route.path || '/'` fallback branch.
    routeState.path = '';
    await wrapper.vm.$nextTick();
    expect(wrapper.get('[data-test="crumbs"]').text()).toContain('/library');
  });
});
