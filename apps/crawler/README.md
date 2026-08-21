# crawler

Keeps every OpenSpecs document alive on a set of relays. It reads kind 30817 from
the relays the web app queries, and copies what it finds to relays that would
otherwise never see it. Copying needs no key and no account: a document carries
its author's signature from the day it was written, and every relay checks that
signature itself.

It can also preserve the versions of a document that relays throw away, which is
the one thing here that does take a key. That is opt in, and a crawler that only
copies is a useful crawler.

## Running one

Anyone can, and the corpus is worth more for every one that exists: no key, no
account, no port to open, a few megabytes of state on disk and a connection that
wakes up every few minutes. The image is published on every push to `main`.

```sh
cd infra
cp .env.example .env
docker compose -f docker-compose.crawler.yml up -d
```

That pulls `ghcr.io/nogringo/openspecs/crawler` and keeps its state in a named
volume mounted at `/data`. Which relays it walks is in the `.env` you just
copied, rather than in the compose file this repository updates under you. The
line that matters is your own relay, because a mirror list of one is a single
operator deciding what survives, and a list given replaces the built in one:

```sh
OPENSPECS_CRAWLER_MIRRORS=wss://relay.example.org
```

From a checkout instead, with the Dart SDK in hand:

```sh
dart run bin/crawler.dart
```

It runs until it is stopped, and it is meant to. Ctrl-C, or the signal a
supervisor sends, puts the walk down cleanly.

## How it works

Reading is `sync_engine_shim_for_ndk`. The engine is told once what to keep
available, and it owns the paging and the watermarks from there: a relay that
answered is only asked what it learned since, a relay that was unreachable is
walked again, and the state survives a restart, so a crawler that was down for a
day does not read the whole corpus back. It has no clock of its own, so this app
brings the ticker: each tick is a refresh.

Writing is NIP-77. Negentropy settles which documents a relay is missing in a
couple of round trips, whatever the size of the corpus, which is what makes it
reasonable to ask the question every few minutes. It reconciles ids only, so the
documents themselves follow as ordinary `EVENT` messages. A relay that does not
speak NIP-77 is left alone rather than blind pushed to.

Both sides meet in the NDK cache: the engine fills it, the mirroring reads it.
Documents are addressable, so the cache hands back the newest revision of each,
which is what a mirror should carry.

## Archiving versions

A document is an addressable event, and relays keep exactly one revision of one
of those. Every edit erases what the document said before, so its history
disappears on its own and no amount of mirroring brings it back: a mirror copies
what exists now.

[Snapshots of Replaceable Events][spec] answers that. Kind 1349 is a regular
event carrying one version of a document in its `content`, and relays keep
regular events forever. Give the crawler a key and every revision it reads is
preserved as one:

```sh
OPENSPECS_CRAWLER_ARCHIVIST_KEY=nsec1...
```

The key signs the snapshot and nothing else. What it proves is that this
archivist saw this version, never who wrote it, because the document inside keeps
the author's own signature and that is the one a reader checks. So the right key
here is one generated for this and used nowhere else: an archivist needs no
reputation, no profile and no follows.

Snapshots go to the sources, to the mirrors, and to whatever the archivist's own
relay list names, so a history lands where readers already look. A version
somebody else already preserved is left alone, and it asks the relays what it
archived itself, so a crawler that lost its data directory does not wrap the
corpus a second time.

What is preserved is what was observed. A crawler that was down while a document
was edited twice sees the second version only, and a snapshot proves a version
existed rather than proving a history is complete.

Snapshots are also part of what a crawler carries: it reads them from the sources
and copies them to the mirrors whether or not it holds a key, so history spreads
the way documents do. One whose tags disagree with the event it carries is
dropped rather than copied on, since the tags are written by whoever published
it and anyone can publish one.

[spec]: https://openspecs.uid.ovh/spec/npub1kg4sdvz3l4fr99n2jdz2vdxe2mpacva87hkdetv76ywacsfq5leqquw5te/replaceable-event-snapshots

## Options

| Option | Default | |
| --- | --- | --- |
| `--source`, `-s` | `OPENSPECS_CRAWLER_SOURCES`, else the relays the web app reads | Relay to read documents from, repeatable |
| `--mirror`, `-m` | `OPENSPECS_CRAWLER_MIRRORS`, else see `lib/src/relays.dart` | Relay to copy documents to, repeatable |
| `--data`, `-d` | `.crawler` | Where the cache and the sync state live |
| `--interval`, `-i` | `300` | Seconds between two looks at the source relays |
| `--timeout`, `-t` | `30` | Seconds a relay may take to answer before it is left for later |
| none | `OPENSPECS_CRAWLER_ARCHIVIST_KEY`, else no archiving | The key versions are archived under, as an `nsec` or in hex |

Both relay variables list them separated by commas, and only move the default: an
option given on the command line still wins, and a variable left empty means the
built in list rather than no relay at all.

`OPENSPECS_CRAWLER_ARCHIVIST_KEY` has no option of its own on purpose. It takes
an `nsec` or the same key in hex, and a key given on a command line is one every
other process on the host can read.

The data directory is the whole state. Deleting it makes the next run read
everything again, which costs bandwidth but loses nothing.

A walk that is in flight when the signal arrives is not dropped, it unwinds, and
a source that went quiet holds it until `--timeout` expires. Anything supervising
the process has to allow at least that long before it kills: the compose file
asks for 60 seconds, where Docker would otherwise grant 10.
