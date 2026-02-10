<template>
  <Card :data-test="dataTest">
    <template #content>
      <div class="flex items-start gap-4">
        <Avatar v-if="icon" :icon="icon" shape="circle" class="shrink-0" :pt="avatarPt" />
        <div class="min-w-0">
          <p class="text-sm font-semibold">{{ title }}</p>
          <p v-if="body" class="mt-1 text-sm text-[var(--p-text-muted-color)]">
            {{ body }}
          </p>
          <div v-if="$slots.action" class="mt-4">
            <slot name="action" />
          </div>
        </div>
      </div>
    </template>
  </Card>
</template>

<script setup lang="ts">
import Avatar from 'primevue/avatar';
import Card from 'primevue/card';

withDefaults(
  defineProps<{
    title: string;
    body?: string;
    icon?: string;
    dataTest?: string;
  }>(),
  { body: '', icon: '', dataTest: undefined },
);

const avatarPt = {
  root: { class: 'bg-[var(--p-primary-100)] text-primary' },
};
</script>
