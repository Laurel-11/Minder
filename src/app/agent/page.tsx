import Link from "next/link";
import { ShopBotChat } from "@/components/ShopBotChat";

export default function AgentPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Try it with a shopping agent</h1>
        <p className="mt-2 max-w-prose text-muted">
          ShopBot stands in for any AI agent that shops for you. It is deliberately gullible: it reads store pages and does what they say. Every time it
          wants to pay, it has to ask Chaperone first. Browse the <Link href="/shops" className="underline underline-offset-2">demo stores</Link> it shops at.
        </p>
      </div>
      <ShopBotChat />
    </div>
  );
}
