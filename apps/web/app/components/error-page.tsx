import { isRouteErrorResponse, Link } from "react-router";
import { Shell } from "./shell";

export const ErrorPage = ({ error }: { error: unknown }) => {
  const missing = isRouteErrorResponse(error) && error.status === 404;

  return (
    <Shell>
      <div className="mx-auto max-w-5xl px-6 py-24">
        <p className="font-mono text-xs tracking-wide text-muted">
          {isRouteErrorResponse(error) ? error.status : "error"}
        </p>
        <h1 className="mt-4 font-mono text-3xl font-medium tracking-tight">
          {missing ? "No document at this address" : "The relays did not answer"}
        </h1>
        <p className="mt-4 max-w-xl font-serif text-lg leading-relaxed text-muted">
          {missing
            ? "This address leads to no published document. It may have never existed, or it may live on a relay this server does not read."
            : "This page is built from relays, and they could not be reached. Reloading in a moment usually works."}
        </p>
        <Link
          to="/"
          className="mt-8 inline-block font-mono text-xs uppercase tracking-[0.16em] underline underline-offset-4"
        >
          Back to Open Specs
        </Link>
      </div>
    </Shell>
  );
};
