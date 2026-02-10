import { computed, ref } from 'vue';
import { useCookie } from '#imports';

export type ColorMode = 'light' | 'dark' | 'system';

const COOKIE_NAME = 'colorMode';
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

const getSystemPref = (): 'light' | 'dark' => {
  if (!globalThis.matchMedia) {
    return 'light';
  }
  return globalThis.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

const writeClientCookie = (value: ColorMode) => {
  if (!globalThis.document) {
    return;
  }
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(value)}`,
    'Path=/',
    'SameSite=Lax',
    `Max-Age=${COOKIE_MAX_AGE_SECONDS}`,
  ];

  // Only mark Secure on https to avoid dev issues on http://localhost.
  if (globalThis.location?.protocol === 'https:') {
    parts.push('Secure');
  }

  globalThis.document.cookie = parts.join('; ');
};

export const useColorMode = () => {
  const cookie = useCookie<ColorMode | null>(COOKIE_NAME, {
    default: () => 'system',
    sameSite: 'lax',
    path: '/',
    maxAge: COOKIE_MAX_AGE_SECONDS,
  });

  const resolved = ref<'light' | 'dark'>('light');

  const applyResolved = (value: 'light' | 'dark') => {
    resolved.value = value;
    globalThis.document.documentElement.classList.toggle('dark', value === 'dark');
  };

  const applyMode = (value: ColorMode) => {
    if (!globalThis.document) {
      return;
    }
    const nextResolved = value === 'system' ? getSystemPref() : value;
    applyResolved(nextResolved);
  };

  // Cypress/E2E hook: allow tests to force mode without relying on cookie plumbing.
  // This is a no-op unless tests opt-in by defining window.__setColorMode.
  if (globalThis.window && !(globalThis.window as any).__setColorMode) {
    (globalThis.window as any).__setColorMode = (value: ColorMode) => {
      // Keep cookie + DOM in sync for runtime behavior.
      cookie.value = value;
      writeClientCookie(value);
      applyMode(value);
    };
  }

  const mode = computed<ColorMode>({
    get: () => cookie.value ?? 'system',
    set: (value) => {
      cookie.value = value;
      writeClientCookie(value);
      applyMode(value);
    },
  });

  const setMode = (value: ColorMode) => {
    mode.value = value;
  };

  const toggle = () => {
    const next = resolved.value === 'dark' ? 'light' : 'dark';
    setMode(next);
  };

  return {
    mode,
    resolved,
    applyMode,
    setMode,
    toggle,
  };
};
