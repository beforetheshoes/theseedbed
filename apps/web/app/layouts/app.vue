<template>
  <div>
    <AppTopBar />

    <main
      :class="[
        'mx-auto w-full min-w-0 px-4 py-6 md:px-8 md:py-8',
        isLibraryRoute ? 'max-w-none' : 'max-w-6xl',
      ]"
    >
      <div class="mb-5 flex items-center justify-between gap-4">
        <AppBreadcrumbs />
      </div>
      <div
        v-if="isClient && !authReady"
        class="flex min-h-[30vh] flex-col items-center justify-center gap-3"
        data-test="auth-bootstrap-loading"
      >
        <div
          class="h-10 w-10 animate-spin rounded-full border-4 border-[var(--p-surface-300)] border-t-[var(--p-primary-color)]"
          aria-hidden="true"
        />
        <p class="text-sm text-[var(--p-text-muted-color)]">Loading your session...</p>
      </div>
      <slot v-else />
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from '#imports';
import AppBreadcrumbs from '~/components/shell/AppBreadcrumbs.vue';
import AppTopBar from '~/components/shell/AppTopBar.vue';
import { useAuthReady } from '~/composables/useAuthBootstrap';
const route = useRoute();
const authReady = useAuthReady();
const isClient = typeof window !== 'undefined';
const isLibraryRoute = computed(() => route.path === '/library');
</script>
