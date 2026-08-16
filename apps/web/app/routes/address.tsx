import { parseSpecAddress, specPath } from "@openspecs/nostr";
import { data, redirect } from "react-router";
import { ErrorPage } from "~/components/error-page";
import { NOT_FOUND_HEADERS } from "~/lib/http";
import type { Route } from "./+types/address";

/**
 * An naddr is how a document is shared between Nostr clients, and it carries
 * everything the canonical URL needs. It is not an address this site serves,
 * only one it translates, so it never renders a page of its own.
 */
export async function loader({ params }: Route.LoaderArgs) {
  const pointer = parseSpecAddress(params.address);
  if (pointer === null) throw data("Not found", { status: 404, headers: NOT_FOUND_HEADERS });
  throw redirect(specPath(pointer), 301);
}

export function headers({ errorHeaders }: Route.HeadersArgs) {
  return errorHeaders ?? NOT_FOUND_HEADERS;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <ErrorPage error={error} />;
}
