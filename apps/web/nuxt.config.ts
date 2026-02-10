import Aura from '@primeuix/themes/aura';

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  modules: ['@primevue/nuxt-module', '@nuxtjs/tailwindcss', '@nuxtjs/supabase'],
  // Load font CSS as explicit Nuxt entries (avoid @import inside CSS, which can cause FOUC in dev).
  css: [
    'primeicons/primeicons.css',
    '@fontsource/atkinson-hyperlegible/400.css',
    '@fontsource/atkinson-hyperlegible/700.css',
    '~/assets/css/tailwind.css',
  ],
  // Root is auth-gated; redirect immediately at the server/router level to avoid client flicker
  // and slow auth initialization delays.
  routeRules: {
    '/': { redirect: '/login' },
  },
  primevue: {
    // Align with PrimeVue Nuxt module docs:
    // https://primevue.org/nuxt
    options: {
      ripple: true,
      // Make form controls read as "controls" (esp. in dark mode) without custom CSS.
      inputVariant: 'outlined',
      theme: {
        preset: Aura,
        options: {
          darkModeSelector: '.dark',
          // Prevent Tailwind base resets from overriding PrimeVue component styles.
          // Keep PrimeVue between Tailwind base and Tailwind utilities so utility classes can still win.
          cssLayer: {
            name: 'primevue',
            order: 'base, primevue, components, utilities',
          },
        },
      },
    },
  },
  runtimeConfig: {
    public: {
      apiBaseUrl: process.env.NUXT_PUBLIC_API_BASE_URL,
      supabaseUrl: process.env.NUXT_PUBLIC_SUPABASE_URL,
      supabaseAnonKey: process.env.NUXT_PUBLIC_SUPABASE_ANON_KEY,
    },
  },
  supabase: {
    url: process.env.NUXT_PUBLIC_SUPABASE_URL,
    key: process.env.NUXT_PUBLIC_SUPABASE_ANON_KEY,
    useSsrCookies: false,
    redirect: false,
  },
});
