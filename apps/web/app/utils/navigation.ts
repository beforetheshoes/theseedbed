export type NavVisibility = 'public' | 'authed' | 'all';

export type NavItem = {
  label: string;
  to: string;
  icon: string;
  visibility: NavVisibility;
};

export const appNavItems: NavItem[] = [
  { label: 'Library', to: '/library', icon: 'pi pi-book', visibility: 'all' },
];
