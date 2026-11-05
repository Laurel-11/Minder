import type { Metadata } from "next";
import Link from "next/link";
import { NavLinks } from "@/components/NavLinks";
import { ResetDemo } from "@/components/ResetDemo";
import "./globals.css";

export const metadata: Metadata = {
  title: "Minder",
  description: "Buyer protection for the purchases your AI agent makes, built on PayPal.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        <header className="bg-ink text-paper">
          <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3 sm:flex-nowrap sm:px-6">
            <Link href="/" className="flex items-center gap-2">
              <svg aria-hidden width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6l7-3z" />
                <path d="M9 12l2 2 4-4" />
              </svg>
              <span className="text-lg font-semibold tracking-tight">Minder</span>
            </Link>
            <NavLinks />
          </div>
          <div aria-hidden className="guilloche-dark h-3" />
        </header>
        <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6">{children}</main>
        <footer className="flex flex-wrap justify-center gap-x-2 py-6 text-center text-xs text-muted">
          <span>Sandbox demo. No real money moves.</span>
          <Link href="/status" className="underline underline-offset-2">
            System status
          </Link>
          <ResetDemo />
        </footer>
      </body>
    </html>
  );
}
