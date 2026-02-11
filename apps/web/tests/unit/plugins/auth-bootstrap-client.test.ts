import { describe, expect, it, vi } from 'vitest';

const ensureAuthReadyMock = vi.hoisted(() => vi.fn(async () => {}));

vi.mock('#imports', () => ({
  defineNuxtPlugin: (fn: any) => fn,
}));

vi.mock('~/composables/useAuthBootstrap', () => ({
  ensureAuthReady: ensureAuthReadyMock,
}));

import plugin from '../../../app/plugins/auth-bootstrap.client';

describe('auth-bootstrap.client plugin', () => {
  it('kicks off auth bootstrap on client', () => {
    ensureAuthReadyMock.mockClear();
    plugin({} as any);
    expect(ensureAuthReadyMock).toHaveBeenCalledTimes(1);
  });
});
