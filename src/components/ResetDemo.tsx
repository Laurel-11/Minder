"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** The live demo is shared by everyone who opens it: this puts it back to the sample story. */
export function ResetDemo() {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "working" | "done" | "error">("idle");
  const [message, setMessage] = useState("");
  const reset = async () => {
    setState("working");
    const r = await fetch("/api/demo/restart", { method: "POST" });
    const j = (await r.json().catch(() => ({}))) as { error?: string };
    if (!r.ok) {
      setMessage(j.error ?? "The demo could not be reset.");
      setState("error");
      return;
    }
    setState("done");
    router.refresh();
  };
  return (
    <span className="inline-flex flex-wrap items-baseline justify-center gap-x-2">
      <button type="button" onClick={reset} disabled={state === "working"} className="underline underline-offset-2 hover:text-ink disabled:opacity-50">
        Reset the demo
      </button>
      <span aria-live="polite">{state === "done" ? "Back to the sample story." : state === "error" ? message : ""}</span>
    </span>
  );
}
