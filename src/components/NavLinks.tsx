"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/agent", label: "Try ShopBot" },
  { href: "/", label: "Activity" },
  { href: "/dashboard", label: "Dashboard" },
  { href: "/rules", label: "Rules" },
  { href: "/status", label: "Status" },
];

/** The site menu. On a phone it gets its own full-width row under the logo. */
export function NavLinks() {
  const path = usePathname();
  const current = (href: string) => (href === "/" ? path === "/" || path.startsWith("/purchases") || path.startsWith("/approve") : path.startsWith(href));
  return (
    <nav className="-mx-1 flex w-full items-center gap-3 text-sm text-paper/70 sm:mx-0 sm:w-auto sm:justify-end sm:gap-4">
      {LINKS.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          aria-current={current(l.href) ? "page" : undefined}
          className="whitespace-nowrap rounded px-1 py-1 hover:text-paper aria-[current=page]:font-medium aria-[current=page]:text-paper aria-[current=page]:underline aria-[current=page]:decoration-2 aria-[current=page]:underline-offset-[6px]"
        >
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
