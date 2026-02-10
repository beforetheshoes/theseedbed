import { defineNuxtPlugin } from '#imports';

export default defineNuxtPlugin(() => {
  // Cypress can start interacting before Vue listeners are attached.
  // This gives E2E a stable "hydrated and interactive" signal.
  globalThis.requestAnimationFrame?.(() => {
    if (globalThis.document?.documentElement) {
      globalThis.document.documentElement.dataset.appReady = 'true';
    }
  });
});
