import { describe, expect, it, vi } from 'vitest';

vi.mock('#imports', () => ({
  defineNuxtPlugin: (fn: any) => fn,
}));

import plugin from '../../../app/plugins/primevue-services';

describe('primevue-services plugin', () => {
  it('installs ToastService and ConfirmationService', () => {
    const use = vi.fn();
    plugin({ vueApp: { use } } as any);
    expect(use).toHaveBeenCalledTimes(2);
  });
});
