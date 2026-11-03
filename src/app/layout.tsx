import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Chaperone",
  description: "A PayPal-powered bodyguard for your AI shopping agent.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        <header className="bg-ink text-paper">
          <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3 sm:px-6">
            <Link href="/" className="flex items-center gap-2">
              <svg aria-hidden width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6l7-3z" />
                <path d="M9 12l2 2 4-4" />
              </svg>
              <span className="text-lg font-semibold tracking-tight">Chaperone</span>
            </Link>
            <nav className="flex items-center gap-4 text-sm text-paper/75">
              <Link href="/agent" className="hover:text-paper">Try ShopBot</Link>
              <Link href="/" className="hover:text-paper">Activity</Link>
              <Link href="/dashboard" className="hover:text-paper">Dashboard</Link>
              <Link href="/rules" className="hover:text-paper">Rules</Link>
              <Link href="/status" className="hover:text-paper">Status</Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6">{children}</main>
        <footer className="py-6 text-center text-xs text-muted">Sandbox demo. No real money moves.</footer>
      </body>
    </html>
  );
}
