<template>
  <div>
    <AppTopBar :show-sidebar-toggle="true" @toggleSidebar="sidebarVisible = true" />

    <div
      class="mx-auto grid w-full max-w-6xl min-w-0 grid-cols-1 gap-6 px-4 py-6 md:grid-cols-[16rem_1fr] md:px-8 md:py-8"
    >
      <aside class="hidden md:block">
        <Card>
          <template #content>
            <AppNavMenu />
          </template>
        </Card>
      </aside>

      <main class="min-w-0">
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

    <AppSidebar v-model:visible="sidebarVisible" />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import Card from 'primevue/card';
import AppBreadcrumbs from '~/components/shell/AppBreadcrumbs.vue';
import AppNavMenu from '~/components/shell/AppNavMenu.vue';
import AppSidebar from '~/components/shell/AppSidebar.vue';
import AppTopBar from '~/components/shell/AppTopBar.vue';
import { useAuthReady } from '~/composables/useAuthBootstrap';
const sidebarVisible = ref(false);
const authReady = useAuthReady();
const isClient = typeof window !== 'undefined';
</script>
