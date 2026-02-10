import process from 'node:process';

export function baseURL() {
  // Nuxt internal helper used to configure $fetch's baseURL.
  // In our deployment, the app is mounted at '/'.
  return process.env.NUXT_APP_BASE_URL || '/';
}
