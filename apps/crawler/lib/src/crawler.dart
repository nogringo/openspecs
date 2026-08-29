import 'dart:async';

import 'package:ndk/ndk.dart';
import 'package:sembast/sembast.dart' hide Filter;
import 'package:sync_engine_shim_for_ndk/sync_engine_shim_for_ndk.dart';

import 'archivist.dart';
import 'mirror.dart';
import 'relays.dart';
import 'snapshot.dart';

/// The kinds a crawler carries: the documents, and the snapshots preserving the
/// versions of them relays have already replaced.
const carriedKinds = [specKind, snapshotKind];

/// Keeps every document published on the source relays alive on the mirrors.
///
/// It runs until it is stopped. The sync engine holds the reading side, the
/// clock included: it owns the paging and the watermarks, so a relay that was
/// unreachable is walked again while one that answered is only asked what it
/// learned since, and it goes back on its own every [interval]. This app
/// listens rather than schedules: every pass that lands is followed by a copy
/// to the mirrors.
class Crawler {
  Crawler(
    this.ndk, {
    required Database db,
    required this.cache,
    this.sources = sourceRelays,
    this.mirrors = mirrorRelays,
    this.archivist,
    this.interval = const Duration(minutes: 5),
    this.timeout = const Duration(seconds: 30),
    this.onProgress,
    this.onPass,
    this.onMirror,
    this.onArchive,
  }) : _engine = SyncEngine(ndk, db: db, maxStaleness: interval);

  final Ndk ndk;
  final CacheManager cache;
  final List<String> sources;
  final List<String> mirrors;

  /// Set when this crawler also preserves the versions it reads. Null is the
  /// ordinary case: mirroring needs no key, and archiving is what an operator
  /// opts into.
  final Archivist? archivist;

  /// How long between two looks at the source relays. The engine will not poll
  /// faster than its own floor of 15 seconds, whatever is asked here.
  final Duration interval;

  /// Given to a reconciliation and to a broadcast alike: a relay that stops
  /// answering must not hold the pass open until the next tick.
  final Duration timeout;

  final void Function(SyncProgress progress)? onProgress;
  final void Function(SyncRequestPhase phase)? onPass;
  final void Function(MirrorReport report)? onMirror;
  final void Function(ArchiveReport report)? onArchive;

  final SyncEngine _engine;

  SyncHandle? _handle;
  StreamSubscription<SyncRequestStatus>? _watching;
  Future<void>? _mirroring;
  var _walking = false;

  /// Whether a snapshot turned out to preserve a document, kept by id.
  ///
  /// Verifying one costs a signature check and a snapshot never changes, so the
  /// answer is worth keeping for as long as this runs. The verdict rather than
  /// the document it holds: keeping those would be holding the whole history in
  /// memory, next to the cache that already has it.
  final _vetted = <String, bool>{};

  void start() {
    if (_handle != null) return;

    _engine.start();
    final handle = _engine.ensure(
      SyncRequest(
        filters: [Filter(kinds: carriedKinds)],
        relays: sources,
      ),
    );
    _handle = handle;

    _watching = _engine.watchStatus(handle).listen(_onStatus);
  }

  /// Stops the walk. What was synced stays in the cache, and starting again
  /// picks up where this left off.
  ///
  /// Returns once the walk has actually stopped, which takes as long as the page
  /// in flight: whatever is closed afterwards, the database first among them, is
  /// no longer being read.
  Future<void> stop() async {
    await _watching?.cancel();
    _watching = null;

    await _mirroring;

    // Disposing rather than releasing the handle: this crawler owns the engine
    // and outlives no request of its own, so there is nobody left to hold one.
    await _engine.dispose();
    _handle = null;
  }

  void _onStatus(SyncRequestStatus status) {
    final progress = status.progress;
    if (progress != null) onProgress?.call(progress);

    if (status.phase == SyncRequestPhase.syncing) {
      _walking = true;
      return;
    }

    final settled =
        status.phase == SyncRequestPhase.synced ||
        status.phase == SyncRequestPhase.failed;
    if (!settled || !_walking) return;

    _walking = false;
    onPass?.call(status.phase);
    unawaited(_mirror());
  }

  /// A pass that lands while the mirrors are still being served changes nothing:
  /// the copy in flight reads the cache once, and the next pass will see what it
  /// missed.
  Future<void> _mirror() async {
    if (_mirroring != null) return;

    final copying = _copy();
    _mirroring = copying;
    try {
      await copying;
    } finally {
      _mirroring = null;
    }
  }

  Future<void> _copy() async {
    // Documents are addressable, so the cache hands back the newest revision of
    // each rather than every revision ever written. The older ones are not lost
    // for that: a snapshot is a regular event, so the cache keeps every one of
    // them, and that is where the history actually lives.
    final specs = await cache.loadEvents(kinds: [specKind]);
    final snapshots = await _vettedSnapshots();

    final archived = await _archive(specs, snapshots);

    final carried = [...specs, ...snapshots, ...archived];
    if (carried.isEmpty) return;

    await Future.wait([
      for (final relay in mirrors)
        mirrorTo(
          ndk,
          relay,
          carried,
          kinds: carriedKinds,
          timeout: timeout,
        ).then((report) => onMirror?.call(report)),
    ]);
  }

  /// The snapshots in the cache that hold up, wrapping a document rather than
  /// anything else.
  ///
  /// Their tags are written by whoever published them, so one that disagrees
  /// with what it carries is dropped rather than copied on: a mirror that
  /// forwarded those would let anyone attach arbitrary events to a document's
  /// history.
  Future<List<Nip01Event>> _vettedSnapshots() async {
    final snapshots = await cache.loadEvents(kinds: [snapshotKind]);

    final vetted = <Nip01Event>[];
    for (final snapshot in snapshots) {
      // A verdict is remembered even when it rejects, which is what keeps a
      // relay full of junk from costing a signature check every five minutes.
      if (!_vetted.containsKey(snapshot.id)) {
        final wrapped = await wrappedOf(snapshot, ndk.config.eventVerifier);
        _vetted[snapshot.id] = wrapped?.kind == specKind;
      }

      if (_vetted[snapshot.id]!) vetted.add(snapshot);
    }

    return vetted;
  }

  /// Preserves the revisions nobody has preserved yet, when this crawler holds a
  /// key. The snapshots it just published are handed back so they travel to the
  /// mirrors on this pass rather than the next one.
  Future<List<Nip01Event>> _archive(
    List<Nip01Event> specs,
    List<Nip01Event> snapshots,
  ) async {
    final archivist = this.archivist;
    if (archivist == null || specs.isEmpty) return const [];

    final report = await archivist.archive(
      specs,
      alreadyWrapped: {
        for (final snapshot in snapshots) ?snapshot.getFirstTag('e'),
      },
    );
    if (report.wrapped > 0) onArchive?.call(report);

    return report.published;
  }
}
