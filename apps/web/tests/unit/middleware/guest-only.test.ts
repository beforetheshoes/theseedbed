import { describe, expect, it, vi } from 'vitest';

const navigateToMock = vi.hoisted(() => vi.fn());
const ensureAuthReadyMock = vi.hoisted(() => vi.fn(async () => {}));
const userRef = vi.hoisted(() => {
  const { ref } = require('vue');
  return ref<any>(null);
});

vi.mock('~/composables/useAuthBootstrap', () => ({
  ensureAuthReady: ensureAuthReadyMock,
}));

vi.mock('#imports', () => ({
  defineNuxtRouteMiddleware: (fn: any) => fn,
  navigateTo: navigateToMock,
  useSupabaseUser: () => userRef,
}));

import guestOnly from '../../../app/middleware/guest-only.client';

describe('guest-only middleware', () => {
  it('does not redirect until auth bootstrap resolves', async () => {
    userRef.value = { id: 'u1' };
    navigateToMock.mockClear();

    let resolveBootstrap: (() => void) | null = null;
    ensureAuthReadyMock.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveBootstrap = resolve;
        }),
    );

    const pending = guestOnly();
    expect(navigateToMock).not.toHaveBeenCalled();

    resolveBootstrap?.();
    await pending;

    expect(navigateToMock).toHaveBeenCalledWith('/library');
  });

  it('redirects to /library when signed in', async () => {
    userRef.value = { id: 'u1' };
    ensureAuthReadyMock.mockClear();
    await guestOnly();
    expect(navigateToMock).toHaveBeenCalledWith('/library');
  });

  it('does nothing when signed out', async () => {
    userRef.value = null;
    navigateToMock.mockClear();
    ensureAuthReadyMock.mockClear();
    const result = await guestOnly();
    expect(result).toBeUndefined();
    expect(navigateToMock).not.toHaveBeenCalled();
  });
});
