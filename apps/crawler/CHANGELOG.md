# Changelog

## 1.2.1

- Requires `sync_engine_shim_for_ndk` 0.4.0, where a held request goes back to
  the relays on its own, every `--interval`, for as long as the engine runs
- Drops the ticker this app carried. It asked for a pass the engine was already
  scheduling, and each one ignored the freshness the engine had just written, so
  the sources were read about twice as often as `--interval` announced
- Reads an `--interval` under 15 seconds as 15, the floor the engine holds

## 1.2.0

- Archives versions, when `OPENSPECS_CRAWLER_ARCHIVIST_KEY` names a key. Each
  revision it reads is preserved as a kind 1349 snapshot, published to the
  sources, the mirrors and whatever the archivist's own relay list names. No key
  means it only mirrors, which is still the default
- Asks the relays what it archived under its own key before wrapping a version
  its cache says nothing about, so a lost data directory costs a query rather
  than a second snapshot of every document
- Carries kind 1349 alongside the documents: snapshots are read from the sources
  and copied to the mirrors like anything else, whether this crawler archives or
  not. One that disagrees with the event it holds is dropped rather than copied
  on, so nobody can attach arbitrary events to a document's history through a
  mirror
- Reads two kinds instead of one, which changes what the sync engine was told to
  keep available: the first run after this upgrade walks the corpus in full
  again, then picks up its watermarks as before

## 1.1.0

- Reads the relays it walks from `OPENSPECS_CRAWLER_SOURCES` and
  `OPENSPECS_CRAWLER_MIRRORS`, so a deployment is configured in its own `.env`
  rather than in a file this repository ships. Options still win over both
- Waits for the walk in flight before letting go of the engine, so a stop closes
  the database once nothing is reading it any more
- Requires `sync_engine_shim_for_ndk` 0.3.1, where a stop also covers a walk
  whose handle was released

## 1.0.0

- Reads kind 30817 from the source relays through `sync_engine_shim_for_ndk`
- Copies to the mirror relays over NIP-77, sending only what each one lacks
