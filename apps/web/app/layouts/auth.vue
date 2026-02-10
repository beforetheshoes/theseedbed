<template>
  <div class="flex min-h-screen flex-col">
    <AppTopBar />
    <main class="flex flex-1 items-center justify-center px-4 py-6 md:px-8 md:py-10">
      <div class="mx-auto w-full max-w-lg">
        <slot />
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
import AppTopBar from '~/components/shell/AppTopBar.vue';
</script>
