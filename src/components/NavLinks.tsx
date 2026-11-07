"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS: { href: string; label: string; short?: string }[] = [
  { href: "/agent", label: "Try ShopBot", short: "ShopBot" },
  { href: "/", label: "Activity" },
  { href: "/dashboard", label: "Dashboard" },
  { href: "/rules", label: "Rules" },
  { href: "/receipts", label: "Receipts" },
  { href: "/how-it-works", label: "How it works" },
];

/** The site menu. On a phone it gets its own full-width row under the logo. */
export function NavLinks() {
  const path = usePathname();
  const current = (href: string) => (href === "/" ? path === "/" || path.startsWith("/purchases") || path.startsWith("/approve") : path.startsWith(href));
  return (
    <nav className="-mx-0.5 flex w-full items-center justify-between gap-0.5 overflow-x-auto text-[12px] text-paper/70 sm:mx-0 sm:w-auto sm:justify-end sm:gap-4 sm:overflow-visible sm:text-sm">
      {LINKS.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          aria-current={current(l.href) ? "page" : undefined}
          className="whitespace-nowrap rounded px-0.5 py-1 hover:text-paper sm:px-1 aria-[current=page]:font-medium aria-[current=page]:text-paper aria-[current=page]:underline aria-[current=page]:decoration-2 aria-[current=page]:underline-offset-[6px]"
        >
          {l.short ? (
            <>
              <span className="sm:hidden">{l.short}</span>
              <span className="hidden sm:inline">{l.label}</span>
            </>
          ) : (
            l.label
          )}
        </Link>
      ))}
    </nav>
  );
}
