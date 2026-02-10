import { describe, expect, it, vi } from 'vitest';

const navigateToMock = vi.hoisted(() => vi.fn((to: string) => to));
const userRef = vi.hoisted(() => {
  const { ref } = require('vue');
  return ref<any>(null);
});

vi.mock('#imports', () => ({
  defineNuxtRouteMiddleware: (fn: any) => fn,
  navigateTo: navigateToMock,
  useSupabaseUser: () => userRef,
}));

import authMiddleware from '../../../app/middleware/auth';

describe('auth middleware', () => {
  it('redirects to login when user is missing', () => {
    userRef.value = null;
    navigateToMock.mockClear();

    const result = authMiddleware({ fullPath: '/library?x=1' } as any);

    expect(navigateToMock).toHaveBeenCalledWith('/login?returnTo=%2Flibrary%3Fx%3D1');
    expect(result).toBe('/login?returnTo=%2Flibrary%3Fx%3D1');
  });

  it('allows navigation when user is present', () => {
    userRef.value = { id: 'user-1' };
    navigateToMock.mockClear();

    const result = authMiddleware({ fullPath: '/library' } as any);

    expect(result).toBeUndefined();
    expect(navigateToMock).not.toHaveBeenCalled();
  });
});
