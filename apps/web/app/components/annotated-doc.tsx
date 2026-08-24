import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router";
import { keyTextColor } from "~/lib/color";
import { type Authors, authorName } from "~/lib/profile";
import { authorsState, serverAuthorsState, subscribeAuthors } from "~/lib/profiles";
import type { Spot } from "~/lib/spots";

/** The document's top level elements, skipping the panels this component put there. */
const blocksIn = (doc: HTMLElement): HTMLElement[] =>
  [...doc.children].filter(
    (child): child is HTMLElement =>
      child instanceof HTMLElement && child.dataset.spot === undefined,
  );

const SpotPanel = ({ spot, authors }: { spot: Spot; authors: Authors }) => (
  <div className="rounded-sm border border-dashed border-rule p-4 sm:p-5">
    {spot.entries.map((entry, index) => (
      <div
        key={`${entry.pubkey}:${entry.html.length}`}
        className={index > 0 ? "mt-5 border-t border-rule pt-5" : ""}
      >
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 font-mono text-xs">
          <span className="font-medium" style={{ color: keyTextColor(entry.pubkey) }}>
            {authorName(authors[entry.pubkey] ?? null, entry.npub)}
          </span>
          <Link
            to={entry.diffHref}
            className="text-muted underline decoration-rule underline-offset-2 hover:text-ink hover:decoration-current"
          >
            Whole comparison
          </Link>
        </div>
        <div
          className="doc mt-3 text-[0.9375rem]"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: rendered Markdown
          dangerouslySetInnerHTML={{ __html: entry.html }}
        />
      </div>
    ))}
  </div>
);

/**
 * The document with the places other keys' copies differ marked in its margin.
 * A mark unfolds the change below the passage it concerns, so the proposals
 * come to the reader instead of waiting behind a comparison page.
 *
 * The marks are measured against the rendered elements and the panels are
 * inserted among them, because the document itself is one block of HTML the
 * server rendered: annotating it must not mean re-rendering it.
 */
export const AnnotatedDoc = ({ html, spots }: { html: string; spots: Spot[] }) => {
  const docRef = useRef<HTMLDivElement>(null);
  const kept = useRef<Record<number, HTMLElement>>({});
  const [open, setOpen] = useState<ReadonlySet<number>>(new Set());
  const [tops, setTops] = useState<Record<number, number>>({});
  const [slots, setSlots] = useState<Record<number, HTMLElement>>({});
  const authors = useSyncExternalStore(subscribeAuthors, authorsState, serverAuthorsState);

  /**
   * One object per document, not one per render: React re-applies
   * `dangerouslySetInnerHTML` whenever the wrapper object is new, and setting
   * `innerHTML` again destroys the panels this component planted in the markup.
   */
  const markup = useMemo(() => ({ __html: html }), [html]);

  useEffect(() => {
    const doc = docRef.current;
    if (doc === null) return;
    const blocks = blocksIn(doc);
    const next: Record<number, HTMLElement> = {};
    for (const spot of spots) {
      if (!open.has(spot.element)) continue;
      const existing = kept.current[spot.element];
      if (existing?.isConnected) {
        next[spot.element] = existing;
        continue;
      }
      const slot = document.createElement("div");
      slot.dataset.spot = "";
      slot.className = "diff-spot";
      if (spot.element < 0) {
        doc.insertBefore(slot, doc.firstChild);
      } else {
        const target = blocks[spot.element];
        if (target === undefined) continue;
        target.insertAdjacentElement("afterend", slot);
      }
      next[spot.element] = slot;
    }
    for (const [key, slot] of Object.entries(kept.current)) {
      if (next[Number(key)] === undefined) slot.remove();
    }
    kept.current = next;
    setSlots(next);
  }, [open, spots]);

  useEffect(
    () => () => {
      for (const slot of Object.values(kept.current)) slot.remove();
    },
    [],
  );

  // Positions follow the text: images load, panels open, the window narrows.
  useLayoutEffect(() => {
    const doc = docRef.current;
    if (doc === null) return;
    const measure = () => {
      const blocks = blocksIn(doc);
      const next: Record<number, number> = {};
      for (const spot of spots) {
        if (spot.element < 0) {
          next[spot.element] = 0;
          continue;
        }
        const block = blocks[spot.element];
        if (block !== undefined) next[spot.element] = block.offsetTop;
      }
      setTops(next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(doc);
    return () => observer.disconnect();
  }, [spots]);

  const toggle = (element: number) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(element)) {
        next.delete(element);
      } else {
        next.add(element);
      }
      return next;
    });

  return (
    <div className="relative">
      <div
        ref={docRef}
        className="doc"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: rendered Markdown
        dangerouslySetInnerHTML={markup}
      />
      {spots.map((spot) => {
        const top = tops[spot.element];
        if (top === undefined) return null;
        const keys = new Set(spot.entries.map((entry) => entry.pubkey)).size;
        const label = `${keys === 1 ? "1 key changes" : `${keys} keys change`} this passage`;
        return (
          <button
            key={spot.element}
            type="button"
            onClick={() => toggle(spot.element)}
            aria-expanded={open.has(spot.element)}
            aria-label={label}
            title={label}
            style={{ top }}
            className="absolute left-full ml-1.5 rounded-sm border border-dashed border-rule px-1.5 py-0.5 font-mono text-[0.6875rem] leading-none text-muted hover:border-muted hover:text-ink aria-expanded:border-muted aria-expanded:text-ink lg:ml-5"
          >
            ±{keys}
          </button>
        );
      })}
      {spots.map((spot) => {
        const slot = slots[spot.element];
        if (slot === undefined) return null;
        return createPortal(
          <SpotPanel spot={spot} authors={authors} />,
          slot,
          String(spot.element),
        );
      })}
    </div>
  );
};
