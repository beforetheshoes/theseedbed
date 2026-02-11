import { beforeEach, describe, expect, it, vi } from 'vitest';

const userRef = vi.hoisted(() => {
  const { ref } = require('vue');
  return ref<any>(null);
});

const stateStore = vi.hoisted(() => new Map<string, any>());

const onAuthStateChangeMock = vi.hoisted(() => vi.fn());
const unsubscribeMock = vi.hoisted(() => vi.fn());
const supabaseClientMock = vi.hoisted(() => ({
  auth: {
    onAuthStateChange: onAuthStateChangeMock,
  },
}));

vi.mock('#imports', async () => {
  const actual = await vi.importActual<any>('#imports');
  return {
    ...actual,
    useState: (key: string, init: () => any) => {
      const { ref } = require('vue');
      if (!stateStore.has(key)) {
        stateStore.set(key, ref(init()));
      }
      return stateStore.get(key);
    },
    useSupabaseUser: () => userRef,
    useSupabaseClient: () => supabaseClientMock,
  };
});

describe('useAuthBootstrap', () => {
  beforeEach(() => {
    stateStore.clear();
    userRef.value = null;
    onAuthStateChangeMock.mockReset();
    unsubscribeMock.mockReset();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('returns immediately when window is not available (server environment)', async () => {
    vi.stubGlobal('window', undefined as any);
    onAuthStateChangeMock.mockImplementation(() => ({
      data: { subscription: { unsubscribe: unsubscribeMock } },
    }));

    const { ensureAuthReady } = await import('../../../app/composables/useAuthBootstrap');
    await ensureAuthReady();

    expect(onAuthStateChangeMock).not.toHaveBeenCalled();
  });

  it('sets authReady and user after INITIAL_SESSION', async () => {
    const unsubThatThrows = vi.fn(() => {
      throw new Error('boom');
    });

    let authCb: any;
    onAuthStateChangeMock.mockImplementation((cb: any) => {
      authCb = cb;
      return { data: { subscription: { unsubscribe: unsubThatThrows } } };
    });

    const { ensureAuthReady, useAuthReady } =
      await import('../../../app/composables/useAuthBootstrap');
    const pending = ensureAuthReady();

    authCb('INITIAL_SESSION', { user: { id: 'u1' } });
    await pending;

    expect(useAuthReady().value).toBe(true);
    expect(userRef.value?.id).toBe('u1');
  });

  it('reuses the same bootstrap promise for concurrent callers', async () => {
    let authCb: any;
    onAuthStateChangeMock.mockImplementation((cb: any) => {
      authCb = cb;
      return { data: { subscription: { unsubscribe: unsubscribeMock } } };
    });

    const { ensureAuthReady, useAuthReady } =
      await import('../../../app/composables/useAuthBootstrap');

    const p1 = ensureAuthReady({ timeoutMs: 1000 });
    const p2 = ensureAuthReady({ timeoutMs: 1000 });

    expect(onAuthStateChangeMock).toHaveBeenCalledTimes(1);
    expect(useAuthReady().value).toBe(false);

    authCb('INITIAL_SESSION', { user: { id: 'u2' } });
    await Promise.all([p1, p2]);

    expect(useAuthReady().value).toBe(true);
    expect(userRef.value?.id).toBe('u2');
  });

  it('ignores non-initial auth events and resolves on timeout', async () => {
    vi.useFakeTimers();

    let authCb: any;
    onAuthStateChangeMock.mockImplementation((cb: any) => {
      authCb = cb;
      return { data: { subscription: { unsubscribe: unsubscribeMock } } };
    });

    const { ensureAuthReady, useAuthReady } =
      await import('../../../app/composables/useAuthBootstrap');
    const pending = ensureAuthReady({ timeoutMs: 10 });

    authCb('SIGNED_IN', { user: { id: 'ignored' } });
    expect(useAuthReady().value).toBe(false);

    await vi.advanceTimersByTimeAsync(10);
    await pending;

    expect(useAuthReady().value).toBe(true);
    expect(userRef.value).toBeNull();
  });

  it('treats INITIAL_SESSION with no session as signed out', async () => {
    let authCb: any;
    onAuthStateChangeMock.mockImplementation((cb: any) => {
      authCb = cb;
      return { data: { subscription: { unsubscribe: unsubscribeMock } } };
    });

    const { ensureAuthReady, useAuthReady } =
      await import('../../../app/composables/useAuthBootstrap');
    const pending = ensureAuthReady({ timeoutMs: 1000 });

    authCb('INITIAL_SESSION', null);
    await pending;

    expect(useAuthReady().value).toBe(true);
    expect(userRef.value).toBeNull();
  });

  it('handles INITIAL_SESSION arriving before subscription is stored', async () => {
    onAuthStateChangeMock.mockImplementation((cb: any) => {
      cb('INITIAL_SESSION', { user: { id: 'early' } });
      return { data: { subscription: { unsubscribe: unsubscribeMock } } };
    });

    const { ensureAuthReady, useAuthReady } =
      await import('../../../app/composables/useAuthBootstrap');
    await ensureAuthReady({ timeoutMs: 1000 });

    expect(useAuthReady().value).toBe(true);
    expect(userRef.value?.id).toBe('early');
  });

  it('resolves on timeout without mutating user', async () => {
    vi.useFakeTimers();
    const unsubThatThrows = vi.fn(() => {
      throw new Error('boom');
    });
    onAuthStateChangeMock.mockImplementation(() => ({
      data: { subscription: { unsubscribe: unsubThatThrows } },
    }));

    const { ensureAuthReady, useAuthReady } =
      await import('../../../app/composables/useAuthBootstrap');
    const pending = ensureAuthReady({ timeoutMs: 10 });

    await vi.advanceTimersByTimeAsync(10);
    await pending;

    expect(useAuthReady().value).toBe(true);
    expect(userRef.value).toBeNull();
  });

  it('ignores late INITIAL_SESSION events after timing out', async () => {
    vi.useFakeTimers();
    let authCb: any;
    onAuthStateChangeMock.mockImplementation((cb: any) => {
      authCb = cb;
      return {
        data: {
          subscription: {
            unsubscribe: unsubscribeMock,
          },
        },
      };
    });

    const { ensureAuthReady, useAuthReady } =
      await import('../../../app/composables/useAuthBootstrap');
    const pending = ensureAuthReady({ timeoutMs: 10 });

    await vi.advanceTimersByTimeAsync(10);
    await pending;

    expect(useAuthReady().value).toBe(true);
    expect(userRef.value).toBeNull();

    // If Supabase emits an INITIAL_SESSION after we've already settled, it should be ignored.
    authCb('INITIAL_SESSION', { user: { id: 'late' } });
    expect(userRef.value).toBeNull();
  });

  it('does not subscribe when auth is already ready', async () => {
    const { ensureAuthReady, useAuthReady } =
      await import('../../../app/composables/useAuthBootstrap');
    useAuthReady().value = true;

    await ensureAuthReady();

    expect(onAuthStateChangeMock).not.toHaveBeenCalled();
  });
});
