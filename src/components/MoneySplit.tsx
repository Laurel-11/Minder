import { usd } from "@/lib/money";

export type MoneyPart = { label: string; amount: number; color: string };

// Validated as a set (light surface): lightness band, chroma, colour-blind and normal-vision separation, contrast.
export const SPLIT_COLORS = { trick: "#c0352b", stopped: "#7b5cb0", back: "#1d7a4e", paid: "#3f6fb5" } as const;

const whole = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

/** One whole split into its parts: a tall segmented bar, a legend of names in block order, and the numbers as a table. */
export function MoneySplit({ title, parts }: { title: string; parts: MoneyPart[] }) {
  const shown = parts.filter((p) => p.amount > 0);
  const total = shown.reduce((s, p) => s + p.amount, 0);
  if (total <= 0) return null;
  const share = (p: MoneyPart) => p.amount / total;
  return (
    <figure className="flex flex-col gap-3">
      <figcaption className="text-sm font-semibold">{title}</figcaption>
      <div role="img" aria-label={`${title}: ${shown.map((p) => `${p.label} ${usd(p.amount)}`).join(", ")}.`} className="flex h-7 w-full gap-[2px]">
        {shown.map((p) => (
          <div
            key={p.label}
            tabIndex={0}
            title={`${p.label}: ${usd(p.amount)} (${Math.round(share(p) * 100)}%)`}
            className="flex min-w-0 items-center overflow-hidden rounded-[4px] px-2 text-xs font-medium text-white"
            style={{ flex: `${p.amount} 1 0`, backgroundColor: p.color }}
          >
            {share(p) >= 0.12 ? whole(p.amount) : null}
          </div>
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-5 gap-y-1.5 text-[13px] text-muted">
        {shown.map((p) => (
          <li key={p.label} className="flex items-center gap-2">
            <span aria-hidden className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: p.color }} />
            {p.label}
          </li>
        ))}
      </ul>
      <details className="text-[13px] text-muted">
        <summary className="cursor-pointer">Show as a table</summary>
        <table className="mt-2 w-full max-w-md text-left">
          <tbody>
            {shown.map((p) => (
              <tr key={p.label} className="border-t border-line">
                <td className="py-1 pr-4">{p.label}</td>
                <td className="py-1 pr-4 text-right tabular-nums text-ink">{usd(p.amount)}</td>
                <td className="py-1 text-right tabular-nums">{Math.round(share(p) * 100)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
