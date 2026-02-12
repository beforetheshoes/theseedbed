<template>
  <div>
    <AppTopBar />
    <main class="mx-auto w-full max-w-6xl px-4 py-6 md:px-8 md:py-10">
      <div class="mx-auto w-full max-w-3xl">
        <slot />
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
import AppTopBar from '~/components/shell/AppTopBar.vue';
</script>
