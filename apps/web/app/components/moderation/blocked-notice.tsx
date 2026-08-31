import { CHROME } from "~/components/chrome";

/**
 * What stands where a blocked page would be. Dashed, like everything on this
 * site that is on offer rather than settled: the page is one click away either
 * way, and the sentence says whose choice put it there.
 */
export const BlockedNotice = ({
  line,
  detail,
  onUnblock,
  onShow,
}: {
  line: string;
  /** Which page this is, in the address's own words, since the title is not shown. */
  detail: string;
  onUnblock: () => void;
  onShow: () => void;
}) => (
  <div className="space-y-3 rounded-sm border border-dashed border-rule px-4 py-3">
    <p className="font-serif text-[0.9375rem] leading-snug text-muted">{line}</p>
    <p className="min-w-0 break-all font-mono text-xs text-muted">{detail}</p>
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" onClick={onUnblock} className={CHROME}>
        Unblock
      </button>
      <button type="button" onClick={onShow} className={CHROME}>
        Show anyway
      </button>
    </div>
  </div>
);
