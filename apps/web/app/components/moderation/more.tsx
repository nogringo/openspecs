import { toNaddr, toNpub } from "@openspecs/nostr";
import { useEffect, useState, useSyncExternalStore } from "react";
import { CHROME } from "~/components/chrome";
import { CopyButton } from "~/components/copy-button";
import { Rebroadcast } from "~/components/rebroadcast";
import { block, unblock, useBlocked } from "~/lib/blocked";
import { eventPath } from "~/lib/paths";
import { restoreSession, serverSessionState, sessionState, subscribeSession } from "~/lib/session";
import { ReportForm } from "./report-form";
import { SUGGESTION } from "./styles";

export type MoreTarget =
  | {
      kind: "document";
      pubkey: string;
      id: string;
      coordinate: string;
      identifier: string;
      /** This document's canonical URL, which the address bar already shows. */
      canonical: string;
      /** Where a republished copy of the event would be sent. */
      relays: string[];
    }
  | { kind: "comment"; pubkey: string; id: string }
  | { kind: "account"; pubkey: string };

type Stage = "closed" | "menu" | "report";

/** The same panel a withdrawal and a zap hang off their buttons. */
const PANEL =
  "absolute left-0 top-full z-10 mt-1 w-[min(22rem,calc(100vw-3rem))] space-y-3 rounded-sm border border-rule bg-paper p-3 normal-case tracking-normal shadow-sm";

const ROW = `${SUGGESTION} text-left`;

/**
 * Everything else there is to do with a document, a comment or an account,
 * behind one word.
 *
 * A document's text, its addresses and its signed event live here rather than in
 * the row above it. Most of them serve whoever already knows what an naddr is,
 * and a reading page that spends seven controls on that before its first
 * paragraph is charging every reader for a few. The link is here too, because on
 * a document's own page the address bar is already showing it.
 *
 * Nothing here needs a key. Blocking is this browser deciding what it shows, and
 * the page or the comment flips to the notice that carries the undo, so the menu
 * closes on the click and says nothing more. A report from a reader with no key
 * is signed by one made for it; the form says what that is worth.
 *
 * A report on yourself is a mistake and a block on yourself is a bug, so neither
 * is offered on the reader's own words. On their own document the menu still
 * opens, holding what is left: an author needs their document's address as much
 * as anybody.
 */
export const More = ({ target }: { target: MoreTarget }) => {
  useEffect(restoreSession, []);
  const session = useSyncExternalStore(subscribeSession, sessionState, serverSessionState);
  const blocked = useBlocked();
  const [stage, setStage] = useState<Stage>("closed");

  const me = session.pubkey;
  const mine = me !== null && me === target.pubkey;
  // A comment or an account of the reader's own leaves nothing to put in it.
  if (mine && target.kind !== "document") return null;

  const noun = target.kind;
  const accountBlocked = blocked.pubkeys.has(target.pubkey);
  const thing =
    target.kind === "document"
      ? { type: "a" as const, value: target.coordinate, held: blocked.coordinates }
      : target.kind === "comment"
        ? { type: "e" as const, value: target.id, held: blocked.eventIds }
        : null;
  const thingBlocked = thing?.held.has(thing.value) === true;

  const toggle = (type: "p" | "e" | "a", value: string, held: boolean) => {
    (held ? unblock : block)({ type, value });
    setStage("closed");
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setStage(stage === "closed" ? "menu" : "closed")}
        aria-expanded={stage !== "closed"}
        title={
          mine
            ? "The text, the addresses and the signed event"
            : "The text, addresses, republishing, reporting and blocking"
        }
        className={CHROME}
      >
        More
      </button>

      {stage === "menu" && (
        <div className={PANEL}>
          {target.kind === "document" && (
            <div className="flex flex-col items-start gap-2">
              <CopyButton
                value={target.canonical}
                label="Copy link"
                title={target.canonical}
                className={ROW}
              />
              {/* Fetched rather than held: the page ships the rendered HTML and
                  leaves the source behind, and sending both would double every
                  document's payload for the few who take a copy. */}
              <CopyButton
                value={() =>
                  fetch(eventPath(toNpub(target.pubkey), target.identifier))
                    .then((response) => response.json())
                    .then((event) => String(event.content ?? ""))
                }
                label="Copy markdown"
                title="The whole document, as its author wrote it"
                className={ROW}
              />
              <CopyButton
                value={toNaddr({ pubkey: target.pubkey, identifier: target.identifier })}
                label="Copy naddr"
                title="The document's Nostr address, for any client"
                className={ROW}
              />
              <CopyButton
                value={() =>
                  fetch(eventPath(toNpub(target.pubkey), target.identifier)).then((event) =>
                    event.text(),
                  )
                }
                label="Copy event"
                title="The signed event, exactly as the relays serve it"
                className={ROW}
              />
              <Rebroadcast
                eventUrl={eventPath(toNpub(target.pubkey), target.identifier)}
                relays={target.relays}
                className={ROW}
              />
            </div>
          )}

          {/* Last, and behind a rule: the two that act on somebody rather than on
              what this browser is holding. */}
          <div
            className={`flex flex-col items-start gap-2 ${target.kind === "document" && !mine ? "border-t border-rule pt-3" : ""}`}
            hidden={mine}
          >
            <button type="button" className={ROW} onClick={() => setStage("report")}>
              Report this {noun}
            </button>
            {thing !== null && (
              <button
                type="button"
                className={ROW}
                onClick={() => toggle(thing.type, thing.value, thingBlocked)}
              >
                {thingBlocked ? `Unblock this ${noun}` : `Block this ${noun}`}
              </button>
            )}
            <button
              type="button"
              className={ROW}
              onClick={() => toggle("p", target.pubkey, accountBlocked)}
            >
              {accountBlocked ? "Unblock this account" : "Block this account"}
            </button>
          </div>
        </div>
      )}

      {stage === "report" && (
        <div className={PANEL}>
          <ReportForm me={me} target={target} onClose={() => setStage("closed")} />
        </div>
      )}
    </div>
  );
};
