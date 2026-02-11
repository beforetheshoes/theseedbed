import { describe, expect, it, vi } from 'vitest';

const navigateToMock = vi.hoisted(() => vi.fn((to: string) => to));
const ensureAuthReadyMock = vi.hoisted(() => vi.fn(async () => {}));
const authReadyRef = vi.hoisted(() => {
  const { ref } = require('vue');
  return ref<boolean>(false);
});
const userRef = vi.hoisted(() => {
  const { ref } = require('vue');
  return ref<any>(null);
});

vi.mock('~/composables/useAuthBootstrap', () => ({
  ensureAuthReady: ensureAuthReadyMock,
  useAuthReady: () => authReadyRef,
}));

vi.mock('#imports', () => ({
  defineNuxtRouteMiddleware: (fn: any) => fn,
  navigateTo: navigateToMock,
  useSupabaseUser: () => userRef,
}));

import authMiddleware from '../../../app/middleware/auth';

describe('auth middleware', () => {
  it('does not redirect until auth bootstrap resolves', async () => {
    authReadyRef.value = false;
    userRef.value = null;
    navigateToMock.mockClear();

    let resolveBootstrap: (() => void) | null = null;
    ensureAuthReadyMock.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveBootstrap = () => {
            authReadyRef.value = true;
            resolve();
          };
        }),
    );

    const pending = authMiddleware({ fullPath: '/library' } as any);
    expect(navigateToMock).not.toHaveBeenCalled();

    resolveBootstrap?.();
    await pending;

    expect(navigateToMock).toHaveBeenCalledWith('/login?returnTo=%2Flibrary');
  });

  it('does not redirect when auth remains unknown after bootstrap attempt', async () => {
    authReadyRef.value = false;
    userRef.value = null;
    navigateToMock.mockClear();
    ensureAuthReadyMock.mockClear();
    ensureAuthReadyMock.mockResolvedValueOnce(undefined);

    const result = await authMiddleware({ fullPath: '/library' } as any);

    expect(result).toBeUndefined();
    expect(navigateToMock).not.toHaveBeenCalled();
  });

  it('does not call bootstrap when auth is already ready', async () => {
    authReadyRef.value = true;
    userRef.value = { id: 'user-1' };
    navigateToMock.mockClear();
    ensureAuthReadyMock.mockClear();

    const result = await authMiddleware({ fullPath: '/library' } as any);

    expect(result).toBeUndefined();
    expect(ensureAuthReadyMock).not.toHaveBeenCalled();
    expect(navigateToMock).not.toHaveBeenCalled();
  });

  it('redirects to login when user is missing', async () => {
    authReadyRef.value = true;
    userRef.value = null;
    navigateToMock.mockClear();
    ensureAuthReadyMock.mockClear();

    const result = await authMiddleware({ fullPath: '/library?x=1' } as any);

    expect(navigateToMock).toHaveBeenCalledWith('/login?returnTo=%2Flibrary%3Fx%3D1');
    expect(result).toBe('/login?returnTo=%2Flibrary%3Fx%3D1');
  });

  it('allows navigation when user is present', async () => {
    authReadyRef.value = true;
    userRef.value = { id: 'user-1' };
    navigateToMock.mockClear();
    ensureAuthReadyMock.mockClear();

    const result = await authMiddleware({ fullPath: '/library' } as any);

    expect(result).toBeUndefined();
    expect(navigateToMock).not.toHaveBeenCalled();
  });
});
