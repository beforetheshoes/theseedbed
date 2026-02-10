<template>
  <Breadcrumb class="bg-transparent p-0" :home="home" :model="items" />
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from '#imports';
type BreadcrumbItem = { label: string; to?: string };

const route = useRoute();

const home = computed<BreadcrumbItem>(() => ({ icon: 'pi pi-home', to: '/library' }) as any);

const items = computed<BreadcrumbItem[]>(() => {
  const path = route.path || '/';
  if (path === '/library') {
    return [{ label: 'Library' }];
  }
  if (path === '/books/search') {
    return [{ label: 'Library', to: '/library' }, { label: 'Add books' }];
  }
  if (path.startsWith('/books/')) {
    return [{ label: 'Library', to: '/library' }, { label: 'Book' }];
  }
  return [];
});
</script>
