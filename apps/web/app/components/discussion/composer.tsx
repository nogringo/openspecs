import { renderMarkdown } from "@openspecs/markdown";
import { buildComment, type CommentParent, type CommentRoot } from "@openspecs/nostr";
import { useMemo, useState } from "react";
import { RelayReport } from "~/components/relay-results";
import { addToDiscussion } from "~/lib/discussion";
import { mentionResolver } from "~/lib/mention";
import type { Authors } from "~/lib/profile";
import { type RelayResult, signAndPublish } from "~/lib/publish";
import { writeRelays } from "~/lib/relays";

type State = "writing" | "sending" | "sent" | "failed";

const CHROME =
  "rounded-sm border border-rule px-2 py-1 font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-muted hover:border-muted hover:text-ink disabled:hover:border-rule disabled:hover:text-muted";

const Preview = ({ content, authors }: { content: string; authors: Authors }) => {
  const { html } = useMemo(
    () => renderMarkdown(content, { headingOffset: 3, mention: mentionResolver(authors) }),
    [content, authors],
  );
  return (
    <div
      className="doc rounded-sm border border-rule border-dashed p-3 text-[0.9375rem] leading-relaxed"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized by the pipeline above
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
};

export type ComposerProps = {
  me: string;
  root: CommentRoot;
  parent?: CommentParent | null;
  authors: Authors;
  /** Called once the comment is away, so a reply box can close itself. */
  onSent?: () => void;
  onCancel?: () => void;
};

/**
 * A textarea set in the reading face, because what goes in it is prose about
 * prose. No toolbar: the document above is Markdown and so is this, and a
 * preview says more than a row of buttons ever does.
 */
export const Composer = ({ me, root, parent, authors, onSent, onCancel }: ComposerProps) => {
  const [content, setContent] = useState("");
  const [preview, setPreview] = useState(false);
  const [state, setState] = useState<State>("writing");
  const [relays, setRelays] = useState<string[]>([]);
  const [results, setResults] = useState<RelayResult[]>([]);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    setState("sending");
    setResults([]);
    setError(null);
    try {
      // Everyone this comment is addressed to: the document's author, and the
      // author of the comment it answers. Their inboxes are where it has to land.
      const addressed =
        parent === null || parent === undefined ? [root.pubkey] : [root.pubkey, parent.pubkey];
      const targets = writeRelays(me, { addressed, hints: parent?.relay ? [parent.relay] : [] });
      targets.then(setRelays).catch(() => {});

      const report = await signAndPublish(
        buildComment({ root, parent, content }),
        targets,
        (result) => setResults((answered) => [...answered, result]),
      );

      if (report.accepted === 0) {
        setState("failed");
        setError("No relay accepted it. Nothing was published.");
        return;
      }

      addToDiscussion(report.event);
      setContent("");
      setPreview(false);
      setState("sent");
      onSent?.();
    } catch (reason) {
      setState("failed");
      setError(reason instanceof Error ? reason.message : "that did not work");
    }
  };

  const empty = content.trim() === "";

  return (
    <div className="space-y-3">
      {preview && !empty ? (
        <Preview content={content} authors={authors} />
      ) : (
        <textarea
          value={content}
          onChange={(event) => setContent(event.target.value)}
          rows={parent ? 3 : 4}
          placeholder={parent ? "Reply" : "Write a comment"}
          className="w-full rounded-sm border border-rule bg-paper p-3 font-serif text-[0.9375rem] leading-relaxed text-ink placeholder:text-muted"
        />
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={CHROME}
          onClick={send}
          disabled={empty || state === "sending"}
        >
          {state === "sending" ? "Sending" : parent ? "Reply" : "Post comment"}
        </button>
        {!empty && (
          <button type="button" className={CHROME} onClick={() => setPreview(!preview)}>
            {preview ? "Edit" : "Preview"}
          </button>
        )}
        {onCancel && (
          <button type="button" className={CHROME} onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>

      {(state === "sending" || state === "sent") && relays.length > 0 && (
        <div className="font-mono text-[0.6875rem] uppercase tracking-[0.14em]">
          <RelayReport relays={relays} results={results} done={state === "sent"} />
        </div>
      )}

      {error !== null && (
        <p className="font-serif text-[0.8125rem] leading-snug text-signal-closed">{error}</p>
      )}
    </div>
  );
};
