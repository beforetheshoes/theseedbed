import { describe, expect, it, vi } from 'vitest';

const cookieRef = vi.hoisted(() => {
  const { ref } = require('vue');
  return ref<'light' | 'dark' | 'system'>('system');
});

vi.mock('#imports', async () => {
  const actual = await vi.importActual<any>('#imports');
  return {
    ...actual,
    useCookie: () => cookieRef,
  };
});

import { useColorMode } from '../../../app/composables/useColorMode';

describe('useColorMode', () => {
  it('toggles the html.dark class when mode changes', () => {
    const { setMode } = useColorMode();

    expect(document.documentElement.classList.contains('dark')).toBe(false);
    setMode('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    setMode('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });
});
