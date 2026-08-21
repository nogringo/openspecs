import 'dart:async';

import 'package:ndk/ndk.dart';
import 'package:sembast/sembast.dart' hide Filter;
import 'package:sync_engine_shim_for_ndk/sync_engine_shim_for_ndk.dart';

import 'mirror.dart';
import 'relays.dart';

/// Keeps every document published on the source relays alive on the mirrors.
///
/// It runs until it is stopped. The sync engine holds the reading side: it owns
/// the paging and the watermarks, so a relay that was unreachable is walked
/// again while one that answered is only asked what it learned since. It has no
/// clock of its own, hence the ticker here: each tick is a `refresh`, and every
/// pass that lands is followed by a copy to the mirrors.
///
/// Nothing is scheduled twice over: a tick that fires while a pass is still
/// walking joins it instead of starting a second one.
class Crawler {
  Crawler(
    this.ndk, {
    required Database db,
    required this.cache,
    this.sources = sourceRelays,
    this.mirrors = mirrorRelays,
    this.interval = const Duration(minutes: 5),
    this.timeout = const Duration(seconds: 30),
    this.onProgress,
    this.onPass,
    this.onMirror,
  }) : _engine = SyncEngine(ndk, db: db, maxStaleness: interval);

  final Ndk ndk;
  final CacheManager cache;
  final List<String> sources;
  final List<String> mirrors;

  /// How long between two looks at the source relays.
  final Duration interval;

  /// Given to a reconciliation and to a broadcast alike: a relay that stops
  /// answering must not hold the pass open until the next tick.
  final Duration timeout;

  final void Function(SyncProgress progress)? onProgress;
  final void Function(SyncRequestPhase phase)? onPass;
  final void Function(MirrorReport report)? onMirror;

  final SyncEngine _engine;

  SyncHandle? _handle;
  StreamSubscription<SyncRequestStatus>? _watching;
  Timer? _ticker;
  Future<void>? _mirroring;
  var _walking = false;

  void start() {
    if (_handle != null) return;

    _engine.start();
    final handle = _engine.ensure(
      SyncRequest(
        filters: [
          Filter(kinds: [specKind]),
        ],
        relays: sources,
      ),
    );
    _handle = handle;

    _watching = _engine.watchStatus(handle).listen(_onStatus);
    _ticker = Timer.periodic(interval, (_) => _tick(handle));
  }

  /// Stops the ticker and the walk. What was synced stays in the cache, and
  /// starting again picks up where this left off.
  ///
  /// Returns once the walk has actually stopped, which takes as long as the page
  /// in flight: whatever is closed afterwards, the database first among them, is
  /// no longer being read.
  Future<void> stop() async {
    _ticker?.cancel();
    _ticker = null;

    await _watching?.cancel();
    _watching = null;

    await _mirroring;

    // Disposing rather than releasing the handle: this crawler owns the engine
    // and outlives no request of its own, so there is nobody left to hold one.
    await _engine.dispose();
    _handle = null;
  }

  void _tick(SyncHandle handle) {
    unawaited(_engine.refresh(handle).catchError((_) {}));
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
    // each rather than every revision ever written. That is what a mirror should
    // carry: superseded drafts are not what a reader would be handed anyway.
    final specs = await cache.loadEvents(kinds: [specKind]);
    if (specs.isEmpty) return;

    await Future.wait([
      for (final relay in mirrors)
        mirrorTo(
          ndk,
          relay,
          specs,
          timeout: timeout,
        ).then((report) => onMirror?.call(report)),
    ]);
  }
}
