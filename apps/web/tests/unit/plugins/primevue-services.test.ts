import { describe, expect, it, vi } from 'vitest';

vi.mock('#imports', () => ({
  defineNuxtPlugin: (fn: any) => fn,
}));

import ConfirmationService from 'primevue/confirmationservice';
import ToastService from 'primevue/toastservice';
import plugin from '../../../app/plugins/primevue-services';

describe('primevue-services plugin', () => {
  it('installs ToastService and ConfirmationService', () => {
    const use = vi.fn();
    plugin({ vueApp: { use, _context: { plugins: new Set() } } } as any);
    expect(use).toHaveBeenCalledTimes(2);
  });

  it('does not re-install services that are already installed', () => {
    const use = vi.fn();
    plugin({
      vueApp: { use, _context: { plugins: new Set([ToastService, ConfirmationService]) } },
    } as any);
    expect(use).not.toHaveBeenCalled();
  });
});
