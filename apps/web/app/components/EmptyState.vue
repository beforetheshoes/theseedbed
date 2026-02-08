<template>
  <div class="rounded-lg border border-slate-200/70 bg-white p-6" :data-test="dataTest">
    <div class="flex items-start gap-4">
      <div v-if="icon" class="rounded-full bg-slate-100 p-3 text-slate-600" aria-hidden="true">
        <i :class="icon"></i>
      </div>
      <div class="min-w-0">
        <p class="text-sm font-semibold text-slate-900">{{ title }}</p>
        <p v-if="body" class="mt-1 text-sm text-slate-600">
          {{ body }}
        </p>
        <div v-if="$slots.action" class="mt-4">
          <slot name="action" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    title: string;
    body?: string;
    icon?: string;
    dataTest?: string;
  }>(),
  { body: '', icon: '', dataTest: undefined },
);
</script>
