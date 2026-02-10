import { mount } from '@vue/test-utils';
import PrimeVue from 'primevue/config';
import { describe, expect, it } from 'vitest';

import IndexPage from '../../../app/pages/index.vue';

describe('index page', () => {
  it('renders no user-visible content (root redirects via middleware)', async () => {
    const wrapper = mount(IndexPage, {
      global: {
        plugins: [[PrimeVue, { ripple: false }]],
      },
    });

    expect(wrapper.text().trim()).toBe('');
  });
});
