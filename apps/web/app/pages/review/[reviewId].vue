<template>
  <div class="min-h-screen bg-slate-950/5 text-slate-900">
    <section class="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-12">
      <Card class="shadow-lg">
        <template #title>
          <div class="flex items-center gap-3 text-2xl font-semibold">
            <i class="pi pi-star text-emerald-600" aria-hidden="true"></i>
            <span data-test="public-review-title">Public review</span>
          </div>
        </template>
        <template #subtitle>
          <span class="text-base text-slate-600"> Reserved canonical URL for public reviews. </span>
        </template>
        <template #content>
          <p class="text-sm text-slate-700">
            Review ID:
            <span class="font-mono" data-test="public-review-id">{{ reviewId }}</span>
          </p>
          <p class="mt-3 text-sm text-slate-600">
            This page is a placeholder and will be expanded as public sharing is implemented.
          </p>
        </template>
      </Card>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from '#imports';
import Card from 'primevue/card';

const route = useRoute();
const reviewId = computed(() =>
  typeof route.params.reviewId === 'string' ? route.params.reviewId : '',
);
</script>
