<template>
  <div
    v-if="visible"
    :class="[
      'rounded-md px-3 py-2 text-sm',
      tone === 'error' ? 'bg-rose-50 text-rose-700' : 'bg-slate-100 text-slate-700',
    ]"
    :data-test="dataTest"
  >
    <slot>{{ message }}</slot>
  </div>
</template>

<script setup lang="ts">
import { computed, useSlots } from 'vue';

const props = withDefaults(
  defineProps<{
    tone?: 'info' | 'error';
    message?: string;
    dataTest?: string;
  }>(),
  { tone: 'info', message: '', dataTest: undefined },
);

const visible = computed(() => Boolean(props.message) || Boolean(useSlots().default));
</script>
