import Link from "next/link";
import { STORES } from "@/lib/catalog";

export default function ShopsPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Demo stores</h1>
        <p className="mt-2 max-w-prose text-muted">
          Fictional stores the demo agent can shop at. One of them hides instructions for AI agents on its product pages. Can you spot it?
        </p>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2">
        {STORES.map((s) => (
          <li key={s.slug}>
            <Link href={`/shops/${s.slug}`} className="block rounded-lg border border-line bg-paper p-4 hover:border-ink">
              <p className="font-semibold">{s.name}</p>
              <p className="text-sm text-muted">{s.tagline}</p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
