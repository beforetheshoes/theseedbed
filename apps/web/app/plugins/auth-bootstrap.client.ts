import { defineNuxtPlugin } from '#imports';
import { ensureAuthReady } from '~/composables/useAuthBootstrap';

export default defineNuxtPlugin(() => {
  // Kick off auth bootstrap as early as possible on the client so layouts/middleware
  // can reliably gate redirects/UX on "auth is known".
  void ensureAuthReady();
});
