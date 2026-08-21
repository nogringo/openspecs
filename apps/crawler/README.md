# crawler

Keeps every OpenSpecs document alive on a set of relays. It reads kind 30817 from
the relays the web app queries, and copies what it finds to relays that would
otherwise never see it. No key and no account is involved: a document carries its
author's signature from the day it was written, and every relay checks that
signature itself.

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

## Options

| Option | Default | |
| --- | --- | --- |
| `--source`, `-s` | `OPENSPECS_CRAWLER_SOURCES`, else the relays the web app reads | Relay to read documents from, repeatable |
| `--mirror`, `-m` | `OPENSPECS_CRAWLER_MIRRORS`, else see `lib/src/relays.dart` | Relay to copy documents to, repeatable |
| `--data`, `-d` | `.crawler` | Where the cache and the sync state live |
| `--interval`, `-i` | `300` | Seconds between two looks at the source relays |
| `--timeout`, `-t` | `30` | Seconds a relay may take to answer before it is left for later |

Both variables list relays separated by commas, and only move the default: an
option given on the command line still wins, and a variable left empty means the
built in list rather than no relay at all.

The data directory is the whole state. Deleting it makes the next run read
everything again, which costs bandwidth but loses nothing.

A walk that is in flight when the signal arrives is not dropped, it unwinds, and
a source that went quiet holds it until `--timeout` expires. Anything supervising
the process has to allow at least that long before it kills: the compose file
asks for 60 seconds, where Docker would otherwise grant 10.
