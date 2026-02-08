<template>
  <div class="flex items-center justify-between gap-4">
    <div class="flex items-center gap-3">
      <i v-if="icon" :class="icon" aria-hidden="true"></i>
      <div>
        <p class="text-lg font-semibold text-slate-900">{{ title }}</p>
        <p v-if="subtitle" class="text-sm text-slate-600">{{ subtitle }}</p>
      </div>
    </div>
    <div v-if="$slots.actions" class="shrink-0">
      <slot name="actions" />
    </div>
  </div>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    title: string;
    subtitle?: string;
    icon?: string;
  }>(),
  { subtitle: '', icon: '' },
);
</script>
