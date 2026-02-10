import { describe, expect, it, vi } from 'vitest';

vi.mock('#imports', () => ({
  defineNuxtPlugin: (fn: any) => fn,
}));

import plugin from '../../../app/plugins/app-ready.client';

describe('app-ready.client plugin', () => {
  it('sets html[data-app-ready=true] after first animation frame', () => {
    const prev = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      cb(0);
      return 0 as any;
    }) as any;

    document.documentElement.dataset.appReady = '';
    plugin({} as any);

    expect(document.documentElement.dataset.appReady).toBe('true');

    globalThis.requestAnimationFrame = prev;
  });

  it('no-ops when requestAnimationFrame is unavailable', () => {
    const prev = globalThis.requestAnimationFrame;
    // @ts-expect-error test-only
    delete (globalThis as any).requestAnimationFrame;

    document.documentElement.dataset.appReady = '';
    expect(() => plugin({} as any)).not.toThrow();
    expect(document.documentElement.dataset.appReady).toBe('');

    globalThis.requestAnimationFrame = prev;
  });

  it('no-ops when document is unavailable', () => {
    const prevRaf = globalThis.requestAnimationFrame;
    const prevDoc = (globalThis as any).document;

    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      cb(0);
      return 0 as any;
    }) as any;
    // Simulate an environment without DOM access.
    // @ts-expect-error test-only
    (globalThis as any).document = undefined;

    expect(() => plugin({} as any)).not.toThrow();

    globalThis.requestAnimationFrame = prevRaf;
    (globalThis as any).document = prevDoc;
  });
});
