<template>
  <div class="min-h-screen bg-slate-950/5 text-slate-900">
    <main
      :class="[
        'mx-auto flex w-full flex-col gap-6 px-6 py-12',
        maxWidth === 'md' ? 'max-w-4xl' : 'max-w-5xl',
      ]"
    >
      <slot />
    </main>
  </div>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    maxWidth?: 'md' | 'lg';
  }>(),
  { maxWidth: 'lg' },
);
</script>
