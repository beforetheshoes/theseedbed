<template>
  <Card data-test="public-profile-card">
    <template #title>
      <div class="flex items-center gap-3 text-2xl font-semibold">
        <i class="pi pi-user text-primary" aria-hidden="true"></i>
        <span class="font-serif tracking-tight" data-test="public-profile-title"
          >Public profile</span
        >
      </div>
    </template>
    <template #subtitle>
      <span class="text-base text-[var(--p-text-muted-color)]"
        >Reserved for federation and public profile pages.</span
      >
    </template>
    <template #content>
      <p class="text-sm">
        Handle:
        <span class="font-mono" data-test="public-profile-handle">{{ handle }}</span>
      </p>
      <p class="mt-3 text-sm text-[var(--p-text-muted-color)]">
        This page is a placeholder. ActivityPub JSON responses are not implemented yet.
      </p>
    </template>
  </Card>
</template>

<script setup lang="ts">
definePageMeta({ layout: 'public' });

import { computed } from 'vue';
import { useRoute } from '#imports';
const route = useRoute();
const handle = computed(() => (typeof route.params.handle === 'string' ? route.params.handle : ''));
</script>
