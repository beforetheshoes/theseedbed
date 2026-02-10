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
        <slot />
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
const sidebarVisible = ref(false);
</script>
