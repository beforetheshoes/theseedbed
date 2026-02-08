import { mount } from '@vue/test-utils';
import PrimeVue from 'primevue/config';
import { describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  route: { params: { workId: 'work-123' } },
}));

vi.mock('#imports', () => ({
  useRoute: () => ({
    params: state.route.params,
  }),
}));

import PublicBookPage from '../../../app/pages/book/[workId].vue';

describe('public book placeholder page', () => {
  it('renders the workId parameter', async () => {
    const wrapper = mount(PublicBookPage, {
      global: {
        plugins: [[PrimeVue, { ripple: false }]],
      },
    });

    expect(wrapper.get('[data-test="public-book-title"]').text()).toContain('Public book');
    expect(wrapper.get('[data-test="public-book-work-id"]').text()).toBe('work-123');
  });

  it('falls back when workId is missing', async () => {
    state.route = { params: {} };

    const wrapper = mount(PublicBookPage, {
      global: {
        plugins: [[PrimeVue, { ripple: false }]],
      },
    });

    expect(wrapper.get('[data-test="public-book-work-id"]').text()).toBe('');
  });
});
