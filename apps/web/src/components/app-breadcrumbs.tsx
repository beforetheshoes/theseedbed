"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BreadCrumb } from "primereact/breadcrumb";
import type { MenuItem } from "primereact/menuitem";

const itemTemplate = (item: MenuItem) =>
  item.url ? (
    <Link
      href={item.url}
      className="p-breadcrumb-item-link cursor-pointer text-sm"
    >
      <span>{item.label}</span>
    </Link>
  ) : (
    <span className="text-sm">{item.label}</span>
  );

function buildItems(pathname: string): MenuItem[] {
  if (pathname === "/library") return [];
  if (pathname === "/books/search") {
    return [
      { label: "Library", url: "/library", template: itemTemplate },
      { label: "Add books", template: itemTemplate },
    ];
  }
  if (pathname.startsWith("/books/")) {
    return [
      { label: "Library", url: "/library", template: itemTemplate },
      { label: "Book", template: itemTemplate },
    ];
  }
  if (pathname === "/settings") {
    return [
      { label: "Library", url: "/library", template: itemTemplate },
      { label: "Settings", template: itemTemplate },
    ];
  }
  return [];
}

export function AppBreadcrumbs() {
  const pathname = usePathname();
  const items = buildItems(pathname);

  if (items.length === 0) return null;

  return (
    <BreadCrumb
      data-test="breadcrumbs"
      className="bg-transparent p-0"
      model={items}
      home={undefined}
    />
  );
}
