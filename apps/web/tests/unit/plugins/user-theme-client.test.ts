import { beforeEach, describe, expect, it, vi } from 'vitest';

const ensureAuthReadyMock = vi.hoisted(() => vi.fn());
const apiRequestMock = vi.hoisted(() => vi.fn());
const applyUserThemeMock = vi.hoisted(() => vi.fn());
const userRef = vi.hoisted(() => {
  const { ref } = require('vue');
  return ref<any>(null);
});

vi.mock('#imports', () => ({
  defineNuxtPlugin: (fn: any) => fn,
  useSupabaseUser: () => userRef,
}));

vi.mock('~/composables/useAuthBootstrap', () => ({
  ensureAuthReady: ensureAuthReadyMock,
}));

vi.mock('~/utils/api', () => ({
  apiRequest: apiRequestMock,
}));

vi.mock('~/composables/useUserTheme', () => ({
  applyUserTheme: applyUserThemeMock,
}));

import plugin from '../../../app/plugins/user-theme.client';

describe('user-theme.client plugin', () => {
  beforeEach(() => {
    ensureAuthReadyMock.mockReset();
    apiRequestMock.mockReset();
    applyUserThemeMock.mockReset();
    userRef.value = null;
  });

  it('loads and applies user theme when signed in', async () => {
    userRef.value = { id: 'u1' };
    ensureAuthReadyMock.mockResolvedValue(undefined);
    apiRequestMock.mockResolvedValue({
      theme_primary_color: '#112233',
      theme_accent_color: '#445566',
      theme_font_family: 'atkinson',
    });

    await plugin({} as any);

    expect(ensureAuthReadyMock).toHaveBeenCalledTimes(1);
    expect(apiRequestMock).toHaveBeenCalledWith('/api/v1/me');
    expect(applyUserThemeMock).toHaveBeenCalledWith(
      expect.objectContaining({ theme_primary_color: '#112233' }),
    );
  });

  it('skips profile fetch when signed out', async () => {
    userRef.value = null;
    ensureAuthReadyMock.mockResolvedValue(undefined);

    await plugin({} as any);

    expect(apiRequestMock).not.toHaveBeenCalled();
    expect(applyUserThemeMock).not.toHaveBeenCalled();
  });

  it('fails soft when loading profile throws', async () => {
    userRef.value = { id: 'u2' };
    ensureAuthReadyMock.mockResolvedValue(undefined);
    apiRequestMock.mockRejectedValue(new Error('boom'));

    await expect(plugin({} as any)).resolves.not.toThrow();
    expect(applyUserThemeMock).not.toHaveBeenCalled();
  });
});
