import { describe, expect, it } from 'vitest';

import { appNavItems } from '../../../app/utils/navigation';

describe('navigation', () => {
  it('exports stable primary nav items', () => {
    expect(appNavItems.length).toBeGreaterThan(0);
    expect(appNavItems.find((i) => i.to === '/library')?.label).toBeTruthy();
    expect(appNavItems.every((i) => typeof i.icon === 'string' && i.icon.includes('pi'))).toBe(
      true,
    );
  });
});
