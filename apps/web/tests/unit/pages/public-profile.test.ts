import { mount } from '@vue/test-utils';
import PrimeVue from 'primevue/config';
import { describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  route: { params: { handle: 'reader' } },
}));

vi.mock('#imports', () => ({
  useRoute: () => ({
    params: state.route.params,
  }),
}));

import PublicProfilePage from '../../../app/pages/u/[handle].vue';

describe('public profile placeholder page', () => {
  it('renders the handle parameter', async () => {
    const wrapper = mount(PublicProfilePage, {
      global: {
        plugins: [[PrimeVue, { ripple: false }]],
      },
    });

    expect(wrapper.get('[data-test="public-profile-title"]').text()).toContain('Public profile');
    expect(wrapper.get('[data-test="public-profile-handle"]').text()).toBe('reader');
  });

  it('falls back when handle is missing', async () => {
    state.route = { params: {} };

    const wrapper = mount(PublicProfilePage, {
      global: {
        plugins: [[PrimeVue, { ripple: false }]],
      },
    });

    expect(wrapper.get('[data-test="public-profile-handle"]').text()).toBe('');
  });
});
