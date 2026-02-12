<script setup lang="ts">
import { computed, useAttrs } from 'vue';

defineOptions({ inheritAttrs: false });

const attrs = useAttrs();

const dataTest = computed(() => (attrs['data-test'] as string | undefined) ?? 'cover-placeholder');
const passthroughAttrs = computed(() => {
  const rest = { ...(attrs as Record<string, unknown>) };
  delete rest['data-test'];
  return rest;
});
</script>

<template>
  <div
    v-bind="passthroughAttrs"
    class="flex h-full w-full flex-col items-center justify-center gap-1 text-[var(--p-text-muted-color)]"
    role="img"
    aria-label="No cover"
    :data-test="dataTest"
  >
    <i class="pi pi-book text-lg" aria-hidden="true"></i>
    <span class="text-xs font-medium">No cover</span>
  </div>
</template>
