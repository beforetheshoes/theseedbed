import { defineNuxtPlugin } from '#imports';
import ConfirmationService from 'primevue/confirmationservice';
import ToastService from 'primevue/toastservice';

export default defineNuxtPlugin((nuxtApp) => {
  // Provide PrimeVue service injections for useToast/useConfirm in both SSR and client.
  nuxtApp.vueApp.use(ToastService);
  nuxtApp.vueApp.use(ConfirmationService);
});
