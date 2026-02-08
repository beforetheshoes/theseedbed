import { mount } from '@vue/test-utils';
import PrimeVue from 'primevue/config';
import { describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  route: { params: { reviewId: 'review-123' } },
}));

vi.mock('#imports', () => ({
  useRoute: () => ({
    params: state.route.params,
  }),
}));

import PublicReviewPage from '../../../app/pages/review/[reviewId].vue';

describe('public review placeholder page', () => {
  it('renders the reviewId parameter', async () => {
    const wrapper = mount(PublicReviewPage, {
      global: {
        plugins: [[PrimeVue, { ripple: false }]],
      },
    });

    expect(wrapper.get('[data-test="public-review-title"]').text()).toContain('Public review');
    expect(wrapper.get('[data-test="public-review-id"]').text()).toBe('review-123');
  });

  it('falls back when reviewId is missing', async () => {
    state.route = { params: {} };

    const wrapper = mount(PublicReviewPage, {
      global: {
        plugins: [[PrimeVue, { ripple: false }]],
      },
    });

    expect(wrapper.get('[data-test="public-review-id"]').text()).toBe('');
  });
});
