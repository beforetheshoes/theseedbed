<template>
  <Drawer
    v-model:visible="visible"
    position="left"
    modal
    blockScroll
    dismissable
    class="!w-full sm:!w-80"
  >
    <template #header>
      <div class="flex w-full items-center pr-10">
        <Button variant="text" severity="secondary" data-test="drawer-home" @click="goHome">
          <span class="pi pi-book mr-2 text-primary" aria-hidden="true" />
          <span class="font-semibold tracking-tight">The Seedbed</span>
        </Button>
      </div>
    </template>

    <AppNavMenu :on-navigate="() => (visible = false)" />
  </Drawer>
</template>

<script setup lang="ts">
import Drawer from 'primevue/drawer';
import Button from 'primevue/button';
import { navigateTo } from '#imports';
import AppNavMenu from '~/components/shell/AppNavMenu.vue';

const visible = defineModel<boolean>('visible', { default: false });

const goHome = async () => {
  visible.value = false;
  await navigateTo('/');
};
</script>
