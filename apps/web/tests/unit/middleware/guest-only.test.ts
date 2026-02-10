import { describe, expect, it, vi } from 'vitest';

const navigateToMock = vi.hoisted(() => vi.fn());
const userRef = vi.hoisted(() => {
  const { ref } = require('vue');
  return ref<any>(null);
});

vi.mock('#imports', () => ({
  defineNuxtRouteMiddleware: (fn: any) => fn,
  navigateTo: navigateToMock,
  useSupabaseUser: () => userRef,
}));

import guestOnly from '../../../app/middleware/guest-only.client';

describe('guest-only middleware', () => {
  it('redirects to /library when signed in', () => {
    userRef.value = { id: 'u1' };
    guestOnly();
    expect(navigateToMock).toHaveBeenCalledWith('/library');
  });

  it('does nothing when signed out', () => {
    userRef.value = null;
    navigateToMock.mockClear();
    const result = guestOnly();
    expect(result).toBeUndefined();
    expect(navigateToMock).not.toHaveBeenCalled();
  });
});
