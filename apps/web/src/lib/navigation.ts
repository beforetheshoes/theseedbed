export type NavVisibility = "public" | "authed" | "all";

export type NavItem = {
  label: string;
  to: string;
  visibility: NavVisibility;
};

export const appNavItems: NavItem[] = [
  { label: "Library", to: "/library", visibility: "all" },
  { label: "Settings", to: "/settings", visibility: "all" },
];
