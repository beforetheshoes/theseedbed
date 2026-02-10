<template>
  <Menu :model="model" class="w-full" />
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { MenuItem } from 'primevue/menuitem';
import Menu from 'primevue/menu';
import { appNavItems } from '~/utils/navigation';

type NavMenuItem = MenuItem & {
  to?: string;
};

const props = defineProps<{
  onNavigate?: () => void;
}>();

const model = computed<NavMenuItem[]>(() =>
  appNavItems.map((item) => ({
    label: item.label,
    icon: item.icon,
    to: item.to,
    command: () => props.onNavigate?.(),
  })),
);
</script>
