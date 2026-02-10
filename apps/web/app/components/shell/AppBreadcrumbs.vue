<template>
  <Breadcrumb class="bg-transparent p-0" :home="home" :model="items">
    <template #item="{ item, props }">
      <NuxtLink v-if="item.to" :to="item.to" class="p-breadcrumb-item-link cursor-pointer">
        <span v-if="item.icon" :class="item.icon" aria-hidden="true" />
        <span v-else class="text-sm">{{ item.label }}</span>
      </NuxtLink>
      <span v-else v-bind="props.action" class="text-sm">{{ item.label }}</span>
    </template>
  </Breadcrumb>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from '#imports';

type BreadcrumbItem = { label?: string; icon?: string; to?: string };

const route = useRoute();

// Library is treated as the home destination, so we avoid a separate Home crumb.
const home = computed<BreadcrumbItem | undefined>(() => undefined);

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
