import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import CoverPlaceholder from '../../../app/components/CoverPlaceholder.vue';

describe('CoverPlaceholder', () => {
  it('defaults data-test when not provided', () => {
    const wrapper = mount(CoverPlaceholder);
    expect(wrapper.attributes('data-test')).toBe('cover-placeholder');
  });

  it('uses provided data-test and passes other attrs through', () => {
    const wrapper = mount(CoverPlaceholder, { attrs: { 'data-test': 'custom', id: 'x' } });
    expect(wrapper.attributes('data-test')).toBe('custom');
    expect(wrapper.attributes('id')).toBe('x');
  });
});
