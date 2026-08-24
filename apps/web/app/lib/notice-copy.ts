import type { Notice } from "@openspecs/nostr";
import { specPath } from "@openspecs/nostr";
import { DISCUSSION_ID } from "./paths";

/**
 * What happened, said the way somebody would say it out loud. The document is
 * named by its identifier rather than by its title: a title costs one relay
 * query per row, and the identifier is the name this site files a document
 * under anyway.
 */
export const said = (notice: Notice): string => {
  const name = notice.document.identifier;
  switch (notice.kind) {
    case "comment":
      return `commented on ${name}`;
    case "reply":
      return `replied to you on ${name}`;
    case "thread":
      return `replied under ${name}`;
    case "reaction":
      return notice.onComment ? `reacted to your comment on ${name}` : `reacted to ${name}`;
    case "zap":
      return notice.onComment
        ? `zapped your comment on ${name}, ${notice.sats} sats`
        : `zapped ${name}, ${notice.sats} sats`;
    case "copy":
      return `published under the name ${name}`;
  }
};

/** The same, with who did it in front, which is how a knock at the door reads. */
export const alertLine = (notice: Notice, name: string): string => `${name} ${said(notice)}`;

/**
 * Which comment on the document's page this is about, when it is about one. A
 * comment answering me is itself the place to land; a reaction has no place of
 * its own, so it lands on what it answered.
 */
const anchor = (notice: Notice): string | null => {
  switch (notice.kind) {
    case "comment":
    case "reply":
    case "thread":
      return notice.id;
    case "reaction":
    case "zap":
      return notice.onComment ? notice.targetId : null;
    case "copy":
      return null;
  }
};

/** Falling back to the conversation as a whole, which every document's page has. */
export const noticePath = (notice: Notice): string => {
  const path = specPath(notice.document);
  if (notice.kind === "copy") return path;
  return `${path}#${anchor(notice) ?? DISCUSSION_ID}`;
};
