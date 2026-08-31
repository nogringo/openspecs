import { useEffect, useState, useSyncExternalStore } from "react";
import { Link, useLocation } from "react-router";
import { CHROME } from "~/components/chrome";
import { block, unblock, useBlocked } from "~/lib/blocked";
import { connectPath } from "~/lib/paths";
import { restoreSession, serverSessionState, sessionState, subscribeSession } from "~/lib/session";
import { ReportForm } from "./report-form";
import { SUGGESTION } from "./styles";

export type MoreTarget =
  | { kind: "document"; pubkey: string; id: string; coordinate: string; identifier: string }
  | { kind: "comment"; pubkey: string; id: string }
  | { kind: "account"; pubkey: string };

type Stage = "closed" | "menu" | "report";

/** The same panel a withdrawal and a zap hang off their buttons. */
const PANEL =
  "absolute left-0 top-full z-10 mt-1 w-[min(22rem,calc(100vw-3rem))] space-y-3 rounded-sm border border-rule bg-paper p-3 normal-case tracking-normal shadow-sm";

const ROW = `${SUGGESTION} text-left`;

/**
 * Report or block, behind one word, on a document, a comment and an account.
 *
 * Blocking works without a key: it is this browser deciding what it shows, and
 * the page or the comment flips to the notice that carries the undo, so the
 * menu closes on the click and says nothing more. Reporting is a signed event,
 * so without a key it is a door to the sign in rather than a form.
 *
 * Nothing is offered on the reader's own words: a report on yourself is a
 * mistake and a block on yourself is a bug.
 */
export const More = ({ target }: { target: MoreTarget }) => {
  useEffect(restoreSession, []);
  const session = useSyncExternalStore(subscribeSession, sessionState, serverSessionState);
  const location = useLocation();
  const blocked = useBlocked();
  const [stage, setStage] = useState<Stage>("closed");

  const me = session.pubkey;
  if (me !== null && me === target.pubkey) return null;

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
        title="Report or block"
        className={CHROME}
      >
        More
      </button>

      {stage === "menu" && (
        <div className={PANEL}>
          <div className="flex flex-col items-start gap-2">
            {me === null ? (
              <Link to={connectPath(`${location.pathname}${location.search}`)} className={ROW}>
                Connect a key to report
              </Link>
            ) : (
              <button type="button" className={ROW} onClick={() => setStage("report")}>
                Report this {noun}
              </button>
            )}
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

      {stage === "report" && me !== null && (
        <div className={PANEL}>
          <ReportForm me={me} target={target} onClose={() => setStage("closed")} />
        </div>
      )}
    </div>
  );
};
