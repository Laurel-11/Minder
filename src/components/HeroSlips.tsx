import { usd } from "@/lib/money";

export type DeskSlip = {
  id: string;
  store: string;
  items: { name: string; quantity: number; price: number }[];
  total: number;
  stamp: { label: string; tone: string };
  /** The amount is struck through when no money moved. */
  struck?: boolean;
  note: string;
  noteTone?: string;
  signature?: { name: string; text: string };
  /** A last line in place of a signature. */
  foot?: string;
};

// Back to front. The two slips underneath show only their header, item and amount, so no half-hidden sentences peek out;
// the front slip is read in full.
const PLACE = [
  "left-0 top-0 w-[74%] -rotate-[4deg] sm:w-[70%]",
  "right-0 top-[15%] w-[74%] rotate-[3.5deg] sm:w-[70%]",
  "bottom-0 left-[6%] w-[86%] -rotate-[1.5deg] sm:left-[13%] sm:w-[76%]",
];

/** Three real purchases from the activity, laid on the desk. The stamps land one after another; the block lands last. */
export function HeroSlips({ slips }: { slips: DeskSlip[] }) {
  return (
    <div className="relative h-[440px] sm:h-[460px]" aria-label="Three of Maya's purchases: what Minder did with each">
      {slips.map((s, n) => {
        const front = n === slips.length - 1;
        return (
        <div key={s.id} className={`desk-slip absolute ${PLACE[n + (3 - slips.length)]}`} style={{ zIndex: n }}>
          <article className="slip px-4 pt-0 text-ink">
            <div aria-hidden className="guilloche -mx-4 mb-3 h-3" />
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[11px] text-muted">Pay to</p>
                <p className="truncate font-semibold leading-tight">{s.store}</p>
              </div>
              <span className={`stamp stamp-in shrink-0 text-sm ${s.stamp.tone}`} style={{ animationDelay: `${300 + n * 350}ms` }}>
                {s.stamp.label}
              </span>
            </div>
            <ul className="mt-2.5 space-y-0.5 text-[13px]">
              {s.items.map((i) => (
                <li key={i.name} className="flex justify-between gap-4">
                  <span className="truncate">
                    {i.quantity > 1 ? `${i.quantity} × ` : ""}
                    {i.name}
                  </span>
                  <span className="tabular-nums text-muted">{usd(i.price * i.quantity)}</span>
                </li>
              ))}
            </ul>
            <div className="mt-2.5 flex items-center justify-between border-t border-line pt-2">
              <span className="text-xs text-muted">Amount</span>
              <span className={`rounded border-2 px-1.5 text-sm font-semibold tabular-nums ${s.struck ? "border-block text-block line-through decoration-2" : "border-ink"}`}>
                {usd(s.total)}
              </span>
            </div>
            {front && <p className={`mt-2 text-[12.5px] leading-snug ${s.noteTone ?? "text-muted"}`}>{s.note}</p>}
            {front && s.foot && <p className="mt-2 text-xs text-muted">{s.foot}</p>}
            {front && s.signature && (
              <p className="mt-1 flex items-baseline gap-2">
                <span className="font-signature text-[1.9rem] leading-none">{s.signature.name}</span>
                <span className="text-xs text-muted">{s.signature.text}</span>
              </p>
            )}
          </article>
        </div>
        );
      })}
    </div>
  );
}
