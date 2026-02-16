<template>
  <div
    class="min-h-screen bg-[var(--p-surface-50)] text-[var(--p-text-color)] dark:bg-[var(--p-surface-950)]"
    style="font-family: var(--app-font-family)"
    :data-test="shellTestId"
  >
    <NuxtRouteAnnouncer />
    <NuxtLayout>
      <Toast />
      <ConfirmDialog />
      <NuxtPage :transition="{ name: 'page', mode: 'out-in' }" />
    </NuxtLayout>
  </div>
</template>

<script setup lang="ts">
const shellTestId = 'app-shell';
</script>
