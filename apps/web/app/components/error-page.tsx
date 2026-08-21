import { isRouteErrorResponse, Link } from "react-router";
import { Shell } from "./shell";

/**
 * What was looked for, so a 404 says which of them is missing. A route names it
 * when it throws, since only the route knows what the address was meant to be.
 */
const MISSING = {
  page: {
    title: "No page at this address",
    body: "Nothing this site serves lives here. The documents are all reachable from the listing, and every author from the document they signed.",
  },
  document: {
    title: "No document at this address",
    body: "This address leads to no published document. It may have never existed, or it may live on a relay this server does not read.",
  },
  author: {
    title: "Nothing signed by this key",
    body: "This key has published no document and no profile that reached the relays this server reads. It may have published neither, or only elsewhere.",
  },
  address: {
    title: "This address names nothing",
    body: "An address here is an npub, an nprofile, a NIP-05 address or an naddr. This one is none of them, so there is nothing to look for.",
  },
} as const;

export type MissingKind = keyof typeof MISSING;

/** A 404 that names nothing is one no route recognised: an unknown page. */
const missingKind = (error: unknown): MissingKind | null => {
  if (!isRouteErrorResponse(error) || error.status !== 404) return null;
  const named = (error.data as { missing?: string } | null)?.missing;
  return named !== undefined && named in MISSING ? (named as MissingKind) : "page";
};

export const ErrorPage = ({ error }: { error: unknown }) => {
  const missing = missingKind(error);
  // Only in development, and only from a real throw: a stack is for whoever is
  // writing the page, never for whoever is reading it.
  const stack = import.meta.env.DEV && error instanceof Error ? error.stack : undefined;

  return (
    <Shell>
      <div className="mx-auto max-w-5xl px-6 py-24">
        <p className="font-mono text-xs tracking-wide text-muted">
          {isRouteErrorResponse(error) ? error.status : "error"}
        </p>
        <h1 className="mt-4 font-mono text-3xl font-medium tracking-tight">
          {missing ? MISSING[missing].title : "The relays did not answer"}
        </h1>
        <p className="mt-4 max-w-xl font-serif text-lg leading-relaxed text-muted">
          {missing
            ? MISSING[missing].body
            : "This page is built from relays, and they could not be reached. Reloading in a moment usually works."}
        </p>
        <Link
          to="/"
          className="mt-8 inline-block font-mono text-xs uppercase tracking-[0.16em] underline underline-offset-4"
        >
          Back to Open Specs
        </Link>
        {stack && (
          <pre className="mt-10 overflow-x-auto rounded-sm border border-rule p-4 font-mono text-xs leading-relaxed text-muted">
            <code>{stack}</code>
          </pre>
        )}
      </div>
    </Shell>
  );
};
