import { Link } from "react-router";

export const Shell = ({ children }: { children: React.ReactNode }) => (
  <div className="min-h-dvh bg-paper text-ink">
    <div className="border-b border-rule">
      <div className="mx-auto flex max-w-5xl items-baseline justify-between px-6 py-4">
        <Link to="/" className="font-mono text-xs uppercase tracking-[0.2em]">
          Open Specs
        </Link>
        <p className="hidden font-mono text-[0.6875rem] uppercase tracking-[0.16em] text-muted sm:block">
          Signed and stored on Nostr
        </p>
      </div>
    </div>
    {children}
  </div>
);
