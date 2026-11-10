import Link from "next/link";
import { ShopBotChat } from "@/components/ShopBotChat";
import { TrickLab, type TrickPreset, type TrickTarget } from "@/components/TrickLab";
import { findProduct } from "@/lib/catalog";
import { readDb } from "@/lib/db";
import { TRICK_PRESETS, TRICK_TARGETS } from "@/lib/trick";

export const dynamic = "force-dynamic";

export default async function AgentPage() {
  const db = await readDb();
  const targets: TrickTarget[] = TRICK_TARGETS.map((t) => {
    const hit = findProduct(t.productId)!;
    return {
      productId: t.productId,
      request: t.request,
      example: t.example,
      product: hit.product.name,
      price: hit.product.price,
      store: hit.store.name,
      others: hit.store.products.filter((p) => p.id !== t.productId).map((p) => `${p.name} ($${p.price})`),
    };
  });
  const presets: TrickPreset[] = TRICK_PRESETS.map((p) => ({ ...p }));
  return (
    <div className="page-wide relative left-1/2 flex w-[min(1120px,calc(100vw-2rem))] -translate-x-1/2 flex-col gap-6">
      <div>
        <h1 className="font-display text-3xl font-medium tracking-tight">Try it with a shopping agent</h1>
        <p className="mt-2 max-w-prose text-muted">
          ShopBot stands in for any AI agent that shops for you. It is deliberately gullible: it reads store pages and does what they say. Every time it
          wants to pay, it has to ask Minder first. Browse the <Link href="/shops" className="underline underline-offset-2">demo stores</Link> it shops at.
        </p>
      </div>
      <div className="grid items-start gap-6 lg:grid-cols-2">
        <ShopBotChat />
        <TrickLab targets={targets} presets={presets} initialBoard={db.trickBoard ?? { attempts: 0, fooled: 0, caught: 0, slipped: 0, paidOnSlips: 0 }} />
      </div>
    </div>
  );
}
