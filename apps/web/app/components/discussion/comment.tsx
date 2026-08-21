import { renderMarkdown } from "@openspecs/markdown";
import type { CommentNode, CommentRoot } from "@openspecs/nostr";
import { authorPath, COMMENT_KIND, toNpub } from "@openspecs/nostr";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { AuthorAvatar } from "~/components/author-avatar";
import { NO_RESPONSE, type Response } from "~/lib/discussion";
import { mentionedKeys, mentionResolver } from "~/lib/mention";
import { type Authors, authorName } from "~/lib/profile";
import { wantAuthors } from "~/lib/profiles";
import { Composer } from "./composer";
import { Tally } from "./tally";

/**
 * How deep a reply is drawn before the spine stops moving right. Past this the
 * nesting says less than the width it costs, and the parent's name in the line
 * above still says who is being answered.
 */
const MAX_DEPTH = 3;

/**
 * One hairline per level of reply. Past the last level it stops, and the thread
 * does not: the replies keep coming, they just stop marching across the page.
 */
const SPINE = "mt-6 space-y-6 border-l border-rule pl-4";

const asDate = (seconds: number): string => new Date(seconds * 1000).toISOString().slice(0, 10);

/**
 * The same pipeline the document is rendered by, so a comment is sanitised the
 * way a specification is, its links carry `nofollow` and its images load lazily.
 * Headings are pushed down three levels: a comment is a note inside a document,
 * and it must not compete with the structure of the text it is about.
 */
const Body = ({ content, authors }: { content: string; authors: Authors }) => {
  // Asked for once per comment, and answered in the same batch as the keys that
  // wrote them: a comment is often mostly the people it is addressed to.
  useEffect(() => {
    const keys = mentionedKeys(content);
    if (keys.length > 0) wantAuthors(keys);
  }, [content]);

  const { html } = useMemo(
    () => renderMarkdown(content, { headingOffset: 3, mention: mentionResolver(authors) }),
    [content, authors],
  );
  return (
    <div
      className="doc mt-2 text-[0.9375rem] leading-relaxed"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized by the pipeline above
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
};

export type CommentProps = {
  node: CommentNode;
  authors: Authors;
  responses: Record<string, Response>;
  /** The document this thread hangs from, which stays the root of every reply. */
  root: CommentRoot;
  /** Null when nobody is signed in: the thread is then a record and not a form. */
  me?: string | null;
  depth?: number;
};

export const CommentThread = ({
  node,
  authors,
  responses,
  root,
  me = null,
  depth = 0,
}: CommentProps) => {
  const [replying, setReplying] = useState(false);
  const { comment } = node;
  const npub = toNpub(comment.pubkey);
  const author = authors[comment.pubkey] ?? null;

  return (
    <article className="relative">
      <div className="flex gap-3">
        <Link
          to={authorPath(comment.pubkey)}
          title={`Everything signed by ${npub}`}
          className="mt-0.5 shrink-0"
        >
          <AuthorAvatar pubkey={comment.pubkey} picture={author?.picture ?? null} size={24} />
        </Link>

        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-baseline gap-x-3 font-mono text-xs">
            <Link to={authorPath(comment.pubkey)} className="font-medium hover:underline">
              {authorName(author, npub)}
            </Link>
            <span className="text-muted">{asDate(comment.createdAt)}</span>
          </p>

          <Body content={comment.content} authors={authors} />

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Tally
              response={responses[comment.id] ?? NO_RESPONSE}
              me={me}
              target={{ id: comment.id, pubkey: comment.pubkey, kind: COMMENT_KIND }}
            />
            {me !== null && !replying && (
              <button
                type="button"
                onClick={() => setReplying(true)}
                className="rounded-sm border border-rule px-2 py-1 font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-muted hover:border-muted hover:text-ink"
              >
                Reply
              </button>
            )}
          </div>

          {me !== null && replying && (
            <div className="mt-4">
              <Composer
                me={me}
                root={root}
                parent={{ id: comment.id, pubkey: comment.pubkey }}
                authors={authors}
                onSent={() => setReplying(false)}
                onCancel={() => setReplying(false)}
              />
            </div>
          )}

          {node.replies.length > 0 && (
            <div className={depth < MAX_DEPTH ? SPINE : "mt-6 space-y-6"}>
              {node.replies.map((reply) => (
                <CommentThread
                  key={reply.comment.id}
                  node={reply}
                  authors={authors}
                  responses={responses}
                  root={root}
                  me={me}
                  depth={Math.min(depth + 1, MAX_DEPTH)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </article>
  );
};
