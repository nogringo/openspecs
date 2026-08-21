import type { NostrEvent } from "../src/event";
import casesJson from "./fixtures/cases.json" with { type: "json" };
import discussionJson from "./fixtures/discussion.json" with { type: "json" };
import discussionCasesJson from "./fixtures/discussion-cases.json" with { type: "json" };
import eventsJson from "./fixtures/events.json" with { type: "json" };
import relayListsJson from "./fixtures/relay-lists.json" with { type: "json" };

export const events = eventsJson as NostrEvent[];

/**
 * Kinds 1111, 7 and 9735 as nostrhub, better-nips, Amethyst, imwald and Ditto
 * actually publish them. The interop contract is not a reading of NIP-22, it is
 * what these events say, so this is what the parser is held to.
 */
export const discussionEvents = discussionJson as NostrEvent[];

/** Kind 10002 of the fixture authors, several of them in more than one revision. */
export const relayListEvents = relayListsJson as NostrEvent[];

const cases = casesJson.cases as Record<string, { note: string; ids: string[] }>;

export type CaseName = keyof typeof casesJson.cases;

export const caseEvents = (name: CaseName): NostrEvent[] => {
  const entry = cases[name];
  if (!entry) throw new Error(`unknown fixture case: ${name}`);
  return entry.ids.map((id) => {
    const event = events.find((e) => e.id === id);
    if (!event) throw new Error(`fixture ${id} listed under "${name}" is missing from events.json`);
    return event;
  });
};

export const caseIds = new Set(Object.values(cases).flatMap((c) => c.ids));

const discussionCases = discussionCasesJson.cases as Record<
  string,
  { note: string; ids: string[] }
>;

export type DiscussionCaseName = keyof typeof discussionCasesJson.cases;

export const discussionCase = (name: DiscussionCaseName): NostrEvent[] => {
  const entry = discussionCases[name];
  if (!entry) throw new Error(`unknown discussion fixture case: ${name}`);
  return entry.ids.map((id) => {
    const event = discussionEvents.find((e) => e.id === id);
    if (!event) {
      throw new Error(`fixture ${id} listed under "${name}" is missing from discussion.json`);
    }
    return event;
  });
};
