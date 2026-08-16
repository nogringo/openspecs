import { useEffect, useRef, useState } from "react";

type State = "idle" | "copied" | "failed";

/**
 * Says what it did in place, rather than raising a notice: the answer belongs
 * where the reader is already looking, and it is gone two seconds later.
 */
export const CopyButton = ({
  value,
  label,
  title,
}: {
  /** A string, or a way to go and get one: the event is fetched, not held. */
  value: string | (() => Promise<string>);
  label: string;
  title?: string;
}) => {
  const [state, setState] = useState<State>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => (timer.current === null ? undefined : clearTimeout(timer.current)), []);

  const copy = async () => {
    try {
      const text = typeof value === "string" ? value : await value();
      // Absent on an insecure origin, which is why the failure is a real state.
      await navigator.clipboard.writeText(text);
      setState("copied");
    } catch {
      setState("failed");
    }
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 2000);
  };

  return (
    <button
      type="button"
      onClick={copy}
      title={title}
      className="rounded-sm border border-rule px-2 py-1 text-muted hover:border-muted hover:text-ink"
    >
      <span aria-live="polite">
        {state === "idle" ? label : state === "copied" ? "Copied" : "Copy failed"}
      </span>
    </button>
  );
};
