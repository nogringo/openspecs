import { firstHeading, parseCoordinate, toNpub } from "@openspecs/nostr";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { newSpecPath, specEditPath, specForkPath } from "~/lib/paths";
import { clearDraft, type DraftEntry, type DraftSlot, listDrafts } from "~/lib/spec-draft-store";
import { LABEL, NOTE, REMOVE } from "./fields";

export const ago = (savedAt: number): string => {
  const minutes = Math.round((Date.now() - savedAt) / 60_000);
  if (minutes < 1) return "a moment ago";
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours} hours ago` : "some days ago";
};

const keyOf = (slot: DraftSlot): string =>
  slot.of === "new"
    ? `new:${slot.id}`
    : slot.of === "doc"
      ? `doc:${slot.identifier}`
      : `fork:${slot.origin}`;

const pathOf = (me: string, slot: DraftSlot): string | null => {
  if (slot.of === "new") return newSpecPath(slot.id);
  if (slot.of === "doc") return specEditPath(toNpub(me), slot.identifier);
  const origin = parseCoordinate(slot.origin);
  return origin === null ? null : specForkPath(toNpub(origin.pubkey), origin.identifier);
};

const nameOf = ({ stored }: DraftEntry): string =>
  stored.draft.title.trim() ||
  firstHeading(stored.draft.content) ||
  stored.draft.identifier.trim() ||
  "Untitled";

const WHAT: Record<DraftSlot["of"], string> = {
  new: "New document",
  doc: "Edit",
  fork: "Fork",
};

/**
 * Every draft this key left in this browser, on the page somebody comes to
 * when they mean to write. A draft is otherwise only found again at the address
 * it was typed at, which nobody remembers a week later.
 *
 * Discarding asks twice, since it is the one thing here that cannot be undone.
 */
export const Unfinished = ({ me, current }: { me: string; current: string }) => {
  const [entries, setEntries] = useState<DraftEntry[]>([]);
  const [confirming, setConfirming] = useState<string | null>(null);

  useEffect(() => {
    setEntries(
      listDrafts(me).filter((entry) => !(entry.slot.of === "new" && entry.slot.id === current)),
    );
  }, [me, current]);

  if (entries.length === 0) return null;

  const discard = (entry: DraftEntry) => {
    const key = keyOf(entry.slot);
    if (confirming !== key) {
      setConfirming(key);
      return;
    }
    clearDraft(me, entry.slot);
    setEntries((held) => held.filter((other) => keyOf(other.slot) !== key));
    setConfirming(null);
  };

  return (
    <section className="max-w-[40rem] space-y-3 border-b border-rule pb-8">
      <h2 className={LABEL}>Unfinished in this browser</h2>
      <ul className="space-y-1.5">
        {entries.map((entry) => {
          const key = keyOf(entry.slot);
          const to = pathOf(me, entry.slot);
          return (
            <li key={key} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              {to === null ? (
                <span className="font-serif text-[0.9375rem]">{nameOf(entry)}</span>
              ) : (
                <Link
                  to={to}
                  className="font-serif text-[0.9375rem] underline decoration-rule underline-offset-2 hover:decoration-current"
                >
                  {nameOf(entry)}
                </Link>
              )}
              <span className={NOTE}>
                {WHAT[entry.slot.of]}, {ago(entry.stored.savedAt)}
              </span>
              <button type="button" className={REMOVE} onClick={() => discard(entry)}>
                {confirming === key ? "Discard it for good" : "Discard"}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
};
