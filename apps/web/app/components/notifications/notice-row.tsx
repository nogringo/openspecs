import type { Notice } from "@openspecs/nostr";
import { specPath, toNpub } from "@openspecs/nostr";
import { Link } from "react-router";
import { AuthorAvatar } from "~/components/author-avatar";
import { DISCUSSION_ID } from "~/components/discussion/discussion";
import { keyTextColor } from "~/lib/color";
import { type Authors, authorName } from "~/lib/profile";

const asDate = (seconds: number): string => new Date(seconds * 1000).toISOString().slice(0, 10);

/**
 * What happened, said the way somebody would say it out loud. The document is
 * named by its identifier rather than by its title: a title costs one relay
 * query per row, and the identifier is the name this site files a document
 * under anyway.
 */
const said = (notice: Notice): string => {
  const name = notice.document.identifier;
  switch (notice.kind) {
    case "comment":
      return `commented on ${name}`;
    case "reply":
      return `replied to you on ${name}`;
    case "thread":
      return `replied under ${name}`;
    case "reaction":
      return `reacted to ${name}`;
    case "zap":
      return `zapped ${name}, ${notice.sats} sats`;
    case "copy":
      return `published under the name ${name}`;
  }
};

/** A reaction's symbol, drawn the way the tally under a document draws it. */
const ReactionMark = ({ notice }: { notice: Notice }) =>
  notice.emojiUrl === null ? (
    <span aria-hidden="true">{notice.content.slice(0, 16)}</span>
  ) : (
    <img
      src={notice.emojiUrl}
      alt=""
      width={14}
      height={14}
      className="inline-block align-[-2px]"
    />
  );

/**
 * A conversation is a client rendered part of the document's page, so a link
 * into it can only name the section until the comment itself has an address.
 */
const destination = (notice: Notice): string => {
  const path = specPath(notice.document);
  return notice.kind === "copy" ? path : `${path}#${DISCUSSION_ID}`;
};

export const NoticeRow = ({
  notice,
  authors,
  unread,
  onFollowed,
}: {
  notice: Notice;
  authors: Authors;
  unread: boolean;
  /** The panel closes behind a row that was followed; the page has nothing to close. */
  onFollowed?: () => void;
}) => {
  const npub = toNpub(notice.pubkey);
  const author = authors[notice.pubkey] ?? null;
  const words = notice.kind === "reaction" ? "" : notice.content;

  return (
    <li className="border-t border-rule first:border-t-0">
      <Link
        to={destination(notice)}
        onClick={onFollowed}
        // The unread mark is a rule in the margin rather than a tinted row: this
        // site marks a thing of yours with a border everywhere else it marks one.
        className={`group flex gap-3 py-3 pl-3 ${
          unread ? "border-l-2 border-muted" : "border-l-2 border-transparent"
        }`}
      >
        <div className="mt-0.5 shrink-0">
          <AuthorAvatar pubkey={notice.pubkey} picture={author?.picture ?? null} size={24} />
        </div>
        <div className="min-w-0 flex-1">
          {/* The date shares the name's line rather than standing in a column of
              its own. A column costs the same eighty pixels on every row, and in
              a panel three hundred wide that is what pushes a short sentence onto
              a third line. */}
          <div className="flex items-baseline justify-between gap-2 font-mono text-xs">
            <span
              style={{ color: keyTextColor(notice.pubkey) }}
              className="truncate font-medium group-hover:underline"
            >
              {authorName(author, npub)}
            </span>
            <time
              dateTime={new Date(notice.createdAt * 1000).toISOString()}
              className="shrink-0 text-[0.6875rem] text-muted"
            >
              {asDate(notice.createdAt)}
            </time>
          </div>
          <p className="mt-0.5 line-clamp-2 font-mono text-xs text-muted">
            {said(notice)}
            {notice.kind === "reaction" && (
              <>
                {" "}
                <ReactionMark notice={notice} />
              </>
            )}
          </p>
          {words !== "" && (
            <p className="mt-1 line-clamp-2 font-serif text-[0.9375rem] leading-snug text-muted">
              {words}
            </p>
          )}
        </div>
      </Link>
    </li>
  );
};
