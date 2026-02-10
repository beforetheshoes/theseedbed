import { watch } from 'vue';
import { defineNuxtPlugin } from '#imports';
import { useColorMode } from '~/composables/useColorMode';

export default defineNuxtPlugin(() => {
  const { mode, applyMode } = useColorMode();

  // Apply immediately on boot (ensures PrimeVue's .dark selector matches).
  applyMode(mode.value);

  // React to cookie changes from within the app.
  watch(
    mode,
    (value) => {
      applyMode(value);
    },
    { immediate: false },
  );

  // Track system changes only when in system mode.
  const media = globalThis.matchMedia?.('(prefers-color-scheme: dark)');
  const handler = () => {
    if (mode.value === 'system') {
      applyMode('system');
    }
  };

  if (media?.addEventListener) {
    media.addEventListener('change', handler);
  } else if (media?.addListener) {
    media.addListener(handler);
  }
});
