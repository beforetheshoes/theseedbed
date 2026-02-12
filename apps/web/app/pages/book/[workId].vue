<template>
  <Card data-test="public-book-card">
    <template #title>
      <div class="flex items-center gap-3 text-2xl font-semibold">
        <i class="pi pi-book text-primary" aria-hidden="true"></i>
        <span class="font-serif tracking-tight" data-test="public-book-title"
          >Public book page</span
        >
      </div>
    </template>
    <template #subtitle>
      <span class="text-base text-[var(--p-text-muted-color)]"
        >Reserved canonical URL for public book pages.</span
      >
    </template>
    <template #content>
      <p class="text-sm">
        Work ID:
        <span class="font-mono" data-test="public-book-work-id">{{ workId }}</span>
      </p>
      <p class="mt-3 text-sm text-[var(--p-text-muted-color)]">
        This page is a placeholder and will be expanded as public sharing is implemented.
      </p>
    </template>
  </Card>
</template>

<script setup lang="ts">
definePageMeta({ layout: 'public' });

import { computed } from 'vue';
import { useRoute } from '#imports';
const route = useRoute();
const workId = computed(() => (typeof route.params.workId === 'string' ? route.params.workId : ''));
</script>
