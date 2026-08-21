# Changelog

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
