import { defineNuxtPlugin } from '#imports';
import ConfirmationService from 'primevue/confirmationservice';
import ToastService from 'primevue/toastservice';

export default defineNuxtPlugin((nuxtApp) => {
  // Provide PrimeVue service injections for useToast/useConfirm in both SSR and client.
  // @primevue/nuxt-module may also install these; Vue warns if a plugin is applied twice.
  const plugins: Set<unknown> | undefined = (nuxtApp.vueApp as any)?._context?.plugins;
  if (!plugins?.has(ToastService)) {
    nuxtApp.vueApp.use(ToastService);
  }
  if (!plugins?.has(ConfirmationService)) {
    nuxtApp.vueApp.use(ConfirmationService);
  }
});
