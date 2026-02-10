import { beforeEach, describe, expect, it, vi } from 'vitest';

const cookieRef = vi.hoisted(() => {
  const { ref } = require('vue');
  return ref<'light' | 'dark' | 'system'>('system');
});

vi.mock('#imports', async () => {
  const actual = await vi.importActual<any>('#imports');
  return {
    ...actual,
    useCookie: (_name: string, options?: { default?: () => unknown }) => {
      if ((cookieRef as any).value == null && typeof options?.default === 'function') {
        (cookieRef as any).value = options.default();
      }
      return cookieRef;
    },
  };
});

import { useColorMode } from '../../../app/composables/useColorMode';

describe('useColorMode', () => {
  beforeEach(() => {
    cookieRef.value = 'system';
    document.documentElement.classList.remove('dark');
  });

  it('initializes cookie to the default when missing', () => {
    (cookieRef as any).value = null;
    const { mode } = useColorMode();
    expect(mode.value).toBe('system');
    expect(cookieRef.value).toBe('system');
  });

  it('sets light/dark via setMode and updates html class', () => {
    const { setMode, resolved } = useColorMode();

    setMode('dark');
    expect(resolved.value).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);

    setMode('light');
    expect(resolved.value).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('resolves system mode using matchMedia when available', () => {
    (globalThis as any).matchMedia = vi.fn().mockReturnValue({ matches: true });

    const { applyMode, resolved } = useColorMode();
    applyMode('system');

    expect(resolved.value).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('resolves system mode to light when matchMedia matches is false', () => {
    (globalThis as any).matchMedia = vi.fn().mockReturnValue({ matches: false });

    const { applyMode, resolved } = useColorMode();
    applyMode('system');

    expect(resolved.value).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('falls back to light when matchMedia is not available', () => {
    const prev = globalThis.matchMedia;
    // @ts-expect-error - test-only
    delete (globalThis as any).matchMedia;

    const { applyMode, resolved } = useColorMode();
    applyMode('system');

    expect(resolved.value).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);

    (globalThis as any).matchMedia = prev;
  });

  it('toggles between resolved light and dark', () => {
    const { setMode, toggle, resolved } = useColorMode();

    setMode('light');
    toggle();
    expect(resolved.value).toBe('dark');

    toggle();
    expect(resolved.value).toBe('light');
  });

  it('does not throw when document is unavailable', () => {
    const prev = globalThis.document;
    // @ts-expect-error - test-only
    (globalThis as any).document = undefined;

    const { setMode, applyMode } = useColorMode();
    setMode('dark');
    applyMode('system');

    // Restore to avoid impacting other tests.
    (globalThis as any).document = prev;
  });

  it('defaults to system when cookie is null and supports writing via mode ref', () => {
    const { mode } = useColorMode();
    // If the cookie is explicitly nulled (e.g. user cleared it), we treat it as 'system'.
    (cookieRef as any).value = null;
    expect(mode.value).toBe('system');

    mode.value = 'dark';
    expect(cookieRef.value).toBe('dark');
  });

  it('writes a Secure cookie attribute when running on https', () => {
    const prevLocation = globalThis.location;
    const prevCookie = Object.getOwnPropertyDescriptor(document, 'cookie');
    const writes: string[] = [];

    Object.defineProperty(document, 'cookie', {
      configurable: true,
      get: () => '',
      set: (value: string) => {
        writes.push(value);
      },
    });

    // JSDOM's location is not always writable; define it for this test.
    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      value: { protocol: 'https:' },
    });

    const { setMode } = useColorMode();
    setMode('dark');

    expect(writes.some((c) => c.includes('colorMode=dark'))).toBe(true);
    expect(writes.some((c) => c.includes('Secure'))).toBe(true);

    // Restore globals.
    if (prevCookie) {
      Object.defineProperty(document, 'cookie', prevCookie);
    }
    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      value: prevLocation,
    });
  });

  it('exposes a window.__setColorMode hook for E2E tests', () => {
    const { setMode } = useColorMode();
    setMode('system');

    expect((window as any).__setColorMode).toBeTypeOf('function');

    (window as any).__setColorMode('dark');
    expect(cookieRef.value).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });
});
