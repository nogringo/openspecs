import { Link } from "react-router";
import { Shell } from "~/components/shell";
import { PAGE_HEADERS } from "~/lib/http";
import { publicOrigin } from "~/lib/origin.server";
import { aboutPath, newSpecPath, specsPath } from "~/lib/paths";
import type { Route } from "./+types/about";

const TITLE = "What this site is";

const DESCRIPTION =
  "How Open Specs works: documents signed by their author, kept on relays, rendered and indexed here.";

const HEADING = "font-mono text-[0.6875rem] uppercase tracking-[0.18em] text-muted";

const BODY = "mt-3 max-w-2xl font-serif text-[0.9375rem] leading-relaxed text-muted";

const LINK = "text-ink underline decoration-rule underline-offset-2 hover:decoration-current";

export async function loader({ request }: Route.LoaderArgs) {
  const origin = publicOrigin(request);
  return { canonical: `${origin}${aboutPath()}` };
}

export function headers(_: Route.HeadersArgs) {
  return PAGE_HEADERS;
}

export function meta({ loaderData }: Route.MetaArgs) {
  return [
    { title: `${TITLE} | Open Specs` },
    { name: "description", content: DESCRIPTION },
    ...(loaderData ? [{ tagName: "link", rel: "canonical", href: loaderData.canonical }] : []),
    { property: "og:type", content: "article" },
    { property: "og:site_name", content: "Open Specs" },
    { property: "og:title", content: TITLE },
    { property: "og:description", content: DESCRIPTION },
    ...(loaderData ? [{ property: "og:url", content: loaderData.canonical }] : []),
    { name: "twitter:card", content: "summary" },
    { name: "twitter:title", content: TITLE },
    { name: "twitter:description", content: DESCRIPTION },
  ];
}

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="mt-12">
    <h2 className={HEADING}>{title}</h2>
    <p className={BODY}>{children}</p>
  </section>
);

/**
 * The page for somebody who read a document, met the word relay, and has no idea
 * what it changes for them. It answers that rather than the protocol: what this
 * site does with a document, what it cannot do to one, and what happens to the
 * document if the site stops. The protocol has its own explainers, and they are
 * linked at the end instead of copied here.
 */
export default function About() {
  return (
    <Shell>
      <main className="mx-auto max-w-5xl px-6 py-16 sm:py-24">
        <h1 className="max-w-3xl text-balance font-mono text-3xl font-medium leading-tight tracking-tight sm:text-4xl">
          {TITLE}
        </h1>
        <p className="mt-6 max-w-2xl font-serif text-lg leading-relaxed text-muted">
          Open Specs is a place to publish a protocol, a format or a convention, and to read the
          ones other people published. Anyone can add one, and nobody has to be let in first.
        </p>

        <Section title="Your address is a key">
          There is no account here, so there is none to be given or taken away. An author is a key,
          and the address of everything they signed is that key written out. A domain expires and
          changes hands; a key does not, and whoever holds it is the only one who can sign as them.
        </Section>

        <Section title="The documents are not here">
          They are on relays, which are small servers that keep signed messages and hand them back
          to whoever asks. This site reads them, renders them and indexes them so a search engine
          and a link preview can see them. It is the reading room, not the shelf.
        </Section>

        <Section title="The conversation is shared">
          Other sites render these same documents, and the comments and reactions under them are the
          same messages, signed the same way. Somebody replying there replies here, with neither
          site knowing about the other. One conversation, several windows onto it.
        </Section>

        <Section title="You can take it with you">
          Nothing published here belongs to this site. Another program reading the same relays shows
          the same document, and if this site stops running the document does not stop existing. The
          code is open, so anybody can run a reading room of their own over the same relays.
        </Section>

        <Section title="A key is yours to keep">
          Make one here and it is made in your browser and stays there. There is no reset link,
          because there is nobody to ask: whoever holds the key is the author. Write it down before
          you need it.
        </Section>

        <Section title="The protocol underneath">
          Keys, relays and signed messages are Nostr, which this site uses rather than teaches. If
          you want the protocol itself,{" "}
          <a href="https://nostr.how" rel="nofollow noopener noreferrer" className={LINK}>
            nostr.how
          </a>{" "}
          walks through it, and{" "}
          <a href="https://nostrapps.com" rel="nofollow noopener noreferrer" className={LINK}>
            nostrapps.com
          </a>{" "}
          lists the programs that speak it.
        </Section>

        <p className="mt-12 font-mono text-[0.6875rem] uppercase tracking-[0.14em]">
          <Link to={specsPath()} className="underline underline-offset-4">
            Read the documents
          </Link>
          <span className="mx-3 text-muted">or</span>
          <Link to={newSpecPath()} className="underline underline-offset-4">
            Write one
          </Link>
        </p>
      </main>
    </Shell>
  );
}
