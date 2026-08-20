# crawler

Keeps every OpenSpecs document alive on a set of relays. It reads kind 30817 from
the relays the web app queries, and copies what it finds to relays that would
otherwise never see it. No key and no account is involved: a document carries its
author's signature from the day it was written, and every relay checks that
signature itself.

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
| `--source`, `-s` | the relays the web app reads | Relay to read documents from, repeatable |
| `--mirror`, `-m` | see `lib/src/relays.dart` | Relay to copy documents to, repeatable |
| `--data`, `-d` | `.crawler` | Where the cache and the sync state live |
| `--interval`, `-i` | `300` | Seconds between two looks at the source relays |
| `--timeout`, `-t` | `30` | Seconds a relay may take to answer before it is left for later |

The data directory is the whole state. Deleting it makes the next run read
everything again, which costs bandwidth but loses nothing.
