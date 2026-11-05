import Link from "next/link";
import { notFound } from "next/navigation";
import { findStore, STORES } from "@/lib/catalog";
import { usd } from "@/lib/money";

export function generateStaticParams() {
  return STORES.map((s) => ({ slug: s.slug }));
}

export default async function StorePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const store = findStore(slug);
  if (!store) notFound();

  return (
    <div className="flex flex-col gap-6">
      <Link href="/shops" className="text-sm text-muted underline underline-offset-2">
        All demo stores
      </Link>
      <div>
        <h1 className="font-display text-3xl font-medium tracking-tight">{store.name}</h1>
        <p className="mt-1 text-muted">{store.tagline}</p>
      </div>
      <ul className="flex flex-col gap-3">
        {store.products.map((p) => (
          <li key={p.id} id={p.id} className="rounded-lg border border-line bg-paper p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="font-semibold">{p.name}</p>
                <p className="text-sm text-muted">{p.description}</p>
              </div>
              <p className="font-semibold tabular-nums">{usd(p.price)}</p>
            </div>
            {/* Deliberately easy for a human to miss, but plain text to an AI agent reading the page. */}
            {p.sellerNote && <p className="mt-3 text-[11px] leading-snug text-[#c9ced6]">Seller note: {p.sellerNote}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}
