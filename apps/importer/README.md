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
pnpm --filter @openspecs/importer build:events   # write the events, sign nothing
pnpm --filter @openspecs/importer test
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

A `nostr:` reference in the target of a link renders as a dead link until
`packages/markdown` learns to resolve one, which is the next thing to build.

## What it does not do yet

Sign, publish, and walk history. Everything here stops at an unsigned event on disk.
