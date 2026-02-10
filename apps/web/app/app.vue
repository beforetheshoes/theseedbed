<template>
  <div
    class="min-h-screen bg-[var(--p-surface-50)] font-sans text-[var(--p-text-color)] dark:bg-[var(--p-surface-950)]"
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
