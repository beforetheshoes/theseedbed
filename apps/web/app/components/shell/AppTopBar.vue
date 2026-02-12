<template>
  <div class="sticky top-0 z-40">
    <Menubar :model="[]" class="relative rounded-none border-x-0 border-t-0 px-3 md:px-5">
      <template #start>
        <div class="flex items-center gap-2">
          <Button
            v-if="showSidebarToggle"
            class="md:hidden"
            icon="pi pi-bars"
            variant="text"
            severity="secondary"
            aria-label="Open navigation"
            data-test="app-nav-open"
            @click="$emit('toggleSidebar')"
          />

          <Button
            variant="text"
            severity="secondary"
            data-test="topbar-home"
            aria-label="Home"
            @click="goHome"
          >
            <span class="pi pi-book mr-2 text-primary" aria-hidden="true" />
            <span class="text-lg font-semibold tracking-tight">The Seedbed</span>
          </Button>
        </div>
      </template>

      <template #end>
        <div class="flex items-center gap-2">
          <AppTopBarBookSearch v-if="userEmail" />

          <!-- On very small viewports, collapse theme controls into a popup to avoid horizontal overflow. -->
          <div class="hidden items-center gap-1 sm:flex" aria-label="Color mode">
            <Button
              icon="pi pi-desktop"
              :variant="mode === 'system' ? 'outlined' : 'text'"
              severity="secondary"
              size="small"
              aria-label="System theme"
              data-test="color-mode-system"
              @click="setAndToast('system')"
            />
            <Button
              icon="pi pi-sun"
              :variant="mode === 'light' ? 'outlined' : 'text'"
              severity="secondary"
              size="small"
              aria-label="Light theme"
              data-test="color-mode-light"
              @click="setAndToast('light')"
            />
            <Button
              icon="pi pi-moon"
              :variant="mode === 'dark' ? 'outlined' : 'text'"
              severity="secondary"
              size="small"
              aria-label="Dark theme"
              data-test="color-mode-dark"
              @click="setAndToast('dark')"
            />
          </div>

          <Button
            class="sm:hidden"
            icon="pi pi-palette"
            variant="text"
            severity="secondary"
            size="small"
            aria-label="Theme menu"
            data-test="color-mode-menu"
            @click="toggleColorMenu"
          />
          <Menu ref="colorMenu" :model="colorItems" popup />

          <Button
            v-if="userEmail"
            icon="pi pi-user"
            variant="text"
            severity="secondary"
            aria-label="Account"
            data-test="account-open"
            @click="toggleAccountMenu"
          />
          <Button v-else asChild v-slot="slotProps" data-test="account-signin">
            <NuxtLink to="/login" :class="slotProps.class">Sign in</NuxtLink>
          </Button>
          <Menu ref="accountMenu" :model="accountItems" popup />
        </div>
      </template>
    </Menubar>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { navigateTo, useSupabaseClient } from '#imports';
import Button from 'primevue/button';
import Menubar from 'primevue/menubar';
import Menu from 'primevue/menu';
import { useToast } from 'primevue/usetoast';
import AppTopBarBookSearch from './AppTopBarBookSearch.vue';
import type { ColorMode } from '~/composables/useColorMode';
import { useColorMode } from '~/composables/useColorMode';

withDefaults(
  defineProps<{
    showSidebarToggle?: boolean;
  }>(),
  { showSidebarToggle: false },
);

defineEmits<{
  toggleSidebar: [];
}>();

const supabase = useSupabaseClient();
const toast = useToast();
const userEmail = ref<string | null>(null);

const { mode, setMode } = useColorMode();

const accountMenu = ref<InstanceType<typeof Menu> | null>(null);
const colorMenu = ref<InstanceType<typeof Menu> | null>(null);

const logoTarget = computed(() => '/');

const goHome = async () => {
  await navigateTo(logoTarget.value);
};

const toggleAccountMenu = (event: Event) => {
  accountMenu.value?.toggle(event);
};

const toggleColorMenu = (event: Event) => {
  colorMenu.value?.toggle(event);
};

const setAndToast = (value: ColorMode) => {
  setMode(value);
  toast.add({
    severity: 'info',
    summary: 'Theme updated',
    detail: value === 'system' ? 'Following system theme.' : `Switched to ${value} mode.`,
    life: 2200,
  });
};

const signOut = async () => {
  if (!supabase) {
    return;
  }
  await supabase.auth.signOut();
  userEmail.value = null;
  toast.add({ severity: 'success', summary: 'Signed out', life: 2000 });
  await navigateTo('/');
};

const colorItems = computed(() => [
  {
    label: 'System',
    icon: 'pi pi-desktop',
    command: () => setAndToast('system'),
    'data-test': 'color-mode-system',
  },
  {
    label: 'Light',
    icon: 'pi pi-sun',
    command: () => setAndToast('light'),
    'data-test': 'color-mode-light',
  },
  {
    label: 'Dark',
    icon: 'pi pi-moon',
    command: () => setAndToast('dark'),
    'data-test': 'color-mode-dark',
  },
]);

const accountItems = computed(() => [
  userEmail.value
    ? { label: userEmail.value, icon: 'pi pi-envelope', disabled: true }
    : { label: 'Not signed in', icon: 'pi pi-user', disabled: true },
  { separator: true },
  ...(userEmail.value
    ? [{ label: 'Sign out', icon: 'pi pi-sign-out', command: () => void signOut() }]
    : [
        {
          label: 'Sign in',
          icon: 'pi pi-sign-in',
          command: () => void navigateTo('/login'),
        },
      ]),
]);

onMounted(async () => {
  if (!supabase) {
    return;
  }
  const { data } = await supabase.auth.getUser();
  userEmail.value = data.user?.email ?? null;
});
</script>
