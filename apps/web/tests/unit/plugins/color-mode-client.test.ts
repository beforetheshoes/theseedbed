import { describe, expect, it, vi } from 'vitest';

const applyModeMock = vi.hoisted(() => vi.fn());
const modeRef = vi.hoisted(() => {
  const { ref } = require('vue');
  return ref<'light' | 'dark' | 'system'>('system');
});

vi.mock('#imports', () => ({
  defineNuxtPlugin: (fn: any) => fn,
}));

vi.mock('~/composables/useColorMode', () => ({
  useColorMode: () => ({
    mode: modeRef,
    applyMode: applyModeMock,
  }),
}));

import plugin from '../../../app/plugins/color-mode.client';

describe('color-mode.client plugin', () => {
  it('applies the current mode on boot and reacts to changes', async () => {
    const addEventListener = vi.fn();
    (globalThis as any).matchMedia = vi.fn().mockReturnValue({
      matches: false,
      addEventListener,
    });

    plugin({} as any);
    expect(applyModeMock).toHaveBeenCalledWith('system');
    expect(addEventListener).toHaveBeenCalled();

    modeRef.value = 'dark';
    // watcher should run; flush microtasks
    await Promise.resolve();
    expect(applyModeMock).toHaveBeenCalledWith('dark');

    // Exercise the system-change handler branch and the non-system branch.
    const handler = addEventListener.mock.calls[0]?.[1] as (() => void) | undefined;
    expect(typeof handler).toBe('function');

    applyModeMock.mockClear();
    modeRef.value = 'system';
    handler?.();
    expect(applyModeMock).toHaveBeenCalledWith('system');

    applyModeMock.mockClear();
    modeRef.value = 'dark';
    handler?.();
    expect(applyModeMock).not.toHaveBeenCalled();
  });

  it('falls back to addListener when addEventListener is unavailable', () => {
    const addListener = vi.fn();
    (globalThis as any).matchMedia = vi.fn().mockReturnValue({
      matches: false,
      addListener,
    });

    plugin({} as any);
    expect(addListener).toHaveBeenCalled();
  });

  it('no-ops when matchMedia is unavailable', () => {
    const prev = globalThis.matchMedia;
    // @ts-expect-error - test-only
    delete (globalThis as any).matchMedia;

    expect(() => plugin({} as any)).not.toThrow();

    (globalThis as any).matchMedia = prev;
  });
});
