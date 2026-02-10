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
      setup:
        (props, { slots }) =>
        () => {
          const renderItem = slots.item;
          const toAnchor = (item: any) =>
            renderItem && item
              ? renderItem({
                  item,
                  props: {
                    action: {
                      class: 'crumb-action',
                      'data-crumb': item.label || item.icon,
                    },
                  },
                })
              : null;

          return h('nav', { 'data-test': 'crumbs' }, [
            h('div', { 'data-test': 'home' }, [toAnchor(props.home)]),
            ...(Array.isArray(props.model) ? props.model : []).map((item: any) =>
              h('div', { 'data-test': `item-${item.label}` }, [toAnchor(item)]),
            ),
            // Exercise Breadcrumb item template branches for coverage:
            // - link item with icon
            // - link item with label only
            h('div', { 'data-test': 'synthetic-icon' }, [
              toAnchor({ to: '/library', icon: 'pi pi-home' }),
            ]),
            h('div', { 'data-test': 'synthetic-label' }, [
              toAnchor({ to: '/library', label: 'Synthetic' }),
            ]),
          ]);
        },
    });

    const wrapper = mount(AppBreadcrumbs, {
      global: {
        stubs: {
          Breadcrumb: BreadcrumbStub,
          NuxtLink: defineComponent({
            name: 'NuxtLink',
            props: ['to'],
            setup:
              (props, { slots, attrs }) =>
              () =>
                h(
                  'a',
                  {
                    href: typeof props.to === 'string' ? props.to : (props.to as any)?.path,
                    ...attrs,
                  },
                  slots.default ? slots.default() : [],
                ),
          }),
        },
      },
    });

    routeState.path = '/library';
    await wrapper.vm.$nextTick();
    expect(wrapper.get('[data-test="item-Library"]').text()).toContain('Library');
    expect(wrapper.get('[data-test="home"]').findAll('a').length).toBe(0);

    routeState.path = '/books/search';
    await wrapper.vm.$nextTick();
    expect(wrapper.get('[data-test="item-Library"] a').attributes('href')).toBe('/library');
    expect(wrapper.get('[data-test="item-Add books"]').text()).toContain('Add books');

    routeState.path = '/books/work-1';
    await wrapper.vm.$nextTick();
    expect(wrapper.get('[data-test="item-Library"] a').attributes('href')).toBe('/library');
    expect(wrapper.get('[data-test="item-Book"]').text()).toContain('Book');

    routeState.path = '/unknown';
    await wrapper.vm.$nextTick();
    expect(wrapper.get('[data-test="home"]').findAll('a').length).toBe(0);
    expect(wrapper.findAll('[data-test^="item-"]').length).toBe(0);

    // Cover the `route.path || '/'` fallback branch.
    routeState.path = '';
    await wrapper.vm.$nextTick();
    expect(wrapper.get('[data-test="home"]').findAll('a').length).toBe(0);
    expect(wrapper.findAll('[data-test^="item-"]').length).toBe(0);
  });
});
