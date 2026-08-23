# Importer

Publishes specifications that live in git as ordinary Nostr documents: the NIPs, the BUDs
and the NUTs, one addressable event each, signed by a key of their own per corpus.

The key proves who copied a document, never who wrote it. What stands in for authorship
is that the copy can be checked: every event names the file it came from in a `proxy` tag,
pinned to a commit, and carries the sha256 of that file's bytes in an `x` tag. Fetch the
source, hash it, compare.

That only means something if the import is reproducible, so it is a pure function of the
manifests and the source repository. Nothing is read from a clock, from the network, or
from a model. Two runs at the same commits write the same bytes, and `manifests/README.md`
is where the judgement went.

## Commands

```sh
pnpm --filter @openspecs/importer build:events     # write the events, sign nothing
pnpm --filter @openspecs/importer publish:events   # show what would be sent
pnpm --filter @openspecs/importer publish:events --yes
```

`build:events` clones each repository into `.cache`, reads every file the manifest lists
at the head of its branch, rewrites the links, and writes one unsigned event per document
into `events/`. Both directories are ignored: one is a checkout, the other is output.

It reports what left the corpus, which is the part worth reading. A link pinned to GitHub
is either a file that is genuinely not a specification, or one the manifest forgot.

## Links

A document that only makes sense next to a website is not a document that lives on relays,
so cross references are rewritten:

| Link                                          | Becomes                          |
| --------------------------------------------- | -------------------------------- |
| To a document of any of the three manifests   | `nostr:naddr1...`, fragment kept |
| To another file of the same repository        | GitHub, pinned to the commit     |
| To anywhere else                              | left alone                       |
| Into the document itself                      | left alone, `rehype-slug` resolves it |

Fenced code is never touched: a link inside an example is part of the example.

## Publishing

`publish:events` reads what `build:events` wrote, signs it, and sends what the relays
do not already hold. It prints its plan and stops; `--yes` is what sends.

A run that changes nothing sends nothing. Every document is compared against the
revision the relays serve, and only what differs is signed, which is what makes running
it again safe and what running it again is for. A document that changed in its manifest
rather than in git is stamped one second past the revision it replaces, since a relay
keeps the older of two events sharing a timestamp.

Keys come from the environment, one per corpus, `OPENSPECS_IMPORT_KEY_<CORPUS>`, an nsec
or the same key in hex. Every key is resolved before the first event is sent, and a key
that is not the one its manifest names is refused: a corpus published under the wrong key
cannot be taken back.

Relays come from `--relay`, repeatable, or `OPENSPECS_IMPORT_RELAYS`. There is no default
and there will not be one. `infra/docker-compose.relay.yml` runs the relay this was
written for.

Both are read from `.env` beside this file, which is ignored, and anything already set in
the shell wins over it:

```sh
cp .env.example .env && chmod 600 .env
```

A file rather than a variable typed in front of the command, because a command is written
to a shell history and a key does not belong there. And a file of its own rather than
`infra/.env`, because that one is read by Docker Compose, and nothing here is a service:
publishing is a command somebody runs on purpose.

## What it does not do yet

Walk history. Every revision a document had before this import is still only in git, and
until it is written as kind 1349 snapshots, publishing a new revision replaces the last
one on the relays and nothing keeps what it said.
