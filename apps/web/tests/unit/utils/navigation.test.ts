import { describe, expect, it } from 'vitest';

import { appNavItems } from '../../../app/utils/navigation';

describe('navigation', () => {
  it('exports stable primary nav items', () => {
    expect(appNavItems.length).toBeGreaterThan(0);
    expect(appNavItems.find((i) => i.to === '/library')?.label).toBeTruthy();
    expect(appNavItems.find((i) => i.to === '/books/search')?.icon).toContain('pi');
  });
});
