import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import App from '../../app/app.vue';

describe('app shell', () => {
  it('renders the shell and page outlet', () => {
    const wrapper = mount(App, {
      global: {
        stubs: {
          NuxtRouteAnnouncer: { template: '<div data-test="announcer" />' },
          NuxtLayout: { template: '<div data-test="layout"><slot /></div>' },
          NuxtPage: { props: ['transition'], template: '<div data-test="page" />' },
          Toast: { template: '<div data-test="toast" />' },
          ConfirmDialog: { template: '<div data-test="confirm" />' },
        },
      },
    });

    expect(wrapper.get('[data-test="app-shell"]').exists()).toBe(true);
    expect(wrapper.get('[data-test="announcer"]').exists()).toBe(true);
    expect(wrapper.get('[data-test="layout"]').exists()).toBe(true);
    expect(wrapper.get('[data-test="page"]').exists()).toBe(true);
  });
});
