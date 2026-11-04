import { SelfTest } from "@/components/SelfTest";

export const dynamic = "force-dynamic";

export default function SelfTestPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Self-test</h1>
        <p className="mt-2 max-w-prose text-muted">
          Two checks to run before recording or submitting. The demo check uses real sandbox payments and trusts PayPal&apos;s records, not Minder&apos;s. The
          exam grades the purchase review against answers written in advance.
        </p>
      </div>
      <SelfTest needsToken={process.env.NODE_ENV === "production"} />
    </div>
  );
}
