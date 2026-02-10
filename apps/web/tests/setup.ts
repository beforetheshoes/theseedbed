import { config } from '@vue/test-utils';
import Avatar from 'primevue/avatar';
import Breadcrumb from 'primevue/breadcrumb';
import Button from 'primevue/button';
import Card from 'primevue/card';
import ConfirmDialog from 'primevue/confirmdialog';
import Dialog from 'primevue/dialog';
import Divider from 'primevue/divider';
import Drawer from 'primevue/drawer';
import InputText from 'primevue/inputtext';
import Menu from 'primevue/menu';
import Message from 'primevue/message';
import Rating from 'primevue/rating';
import Select from 'primevue/select';
import Skeleton from 'primevue/skeleton';
import Tag from 'primevue/tag';
import Textarea from 'primevue/textarea';
import Timeline from 'primevue/timeline';
import Toast from 'primevue/toast';
import Toolbar from 'primevue/toolbar';
import { vi } from 'vitest';

// Register PrimeVue components globally so they resolve in test SFCs
// (Nuxt auto-import is not available in plain Vitest runs).
config.global.components = {
  Avatar,
  Breadcrumb,
  Button,
  Card,
  ConfirmDialog,
  Dialog,
  Divider,
  Drawer,
  InputText,
  Menu,
  Message,
  Rating,
  Select,
  Skeleton,
  Tag,
  Textarea,
  Timeline,
  Toast,
  Toolbar,
};

// Nuxt compiler macros are not transformed in plain Vitest SFC runs.
// Define a global binding so SFCs can call it without throwing.
globalThis.eval?.('var definePageMeta = (meta) => meta');

// Some client-only code paths reference matchMedia (e.g. color mode).
if (!globalThis.matchMedia) {
  (globalThis as any).matchMedia = vi.fn().mockImplementation(() => ({
    matches: false,
    media: '(prefers-color-scheme: dark)',
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}
