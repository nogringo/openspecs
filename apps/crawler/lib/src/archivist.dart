import 'package:ndk/ndk.dart';

import 'snapshot.dart';

/// What one pass archived.
class ArchiveReport {
  const ArchiveReport({this.wrapped = 0, this.published = const []});

  /// Versions this pass found nobody had preserved yet.
  final int wrapped;

  /// The snapshots at least one relay accepted, ready to be mirrored along with
  /// everything else.
  final List<Nip01Event> published;
}

/// Preserves each version of a document it sees, by publishing a snapshot of it.
///
/// The key it signs with proves only who archived a version: the document keeps
/// its author's signature inside, and a reader checks that one. So an archivist
/// key needs no reputation and stands for nothing beyond this.
class Archivist {
  Archivist(
    this.ndk, {
    required this.signer,
    required this.relays,
    this.timeout = const Duration(seconds: 30),
  });

  final Ndk ndk;
  final EventSigner signer;

  /// Where history is written. Worth being the relays readers query rather than
  /// only the ones this operator runs: a version nobody can reach is preserved
  /// for nobody.
  final List<String> relays;

  final Duration timeout;

  /// An archivist writing to [relays] and to wherever it told the world it
  /// writes, so a reader following its relay list finds the history it keeps.
  ///
  /// The relay list is read through NDK, which asks the relays it was
  /// bootstrapped with. An archivist that published none simply writes to
  /// [relays].
  static Future<Archivist> resolve(
    Ndk ndk, {
    required EventSigner signer,
    required List<String> relays,
    Duration timeout = const Duration(seconds: 30),
  }) async {
    final published = await _writeRelaysOf(ndk, signer.getPublicKey());

    return Archivist(
      ndk,
      signer: signer,
      relays: {...relays, ...published}.toList(),
      timeout: timeout,
    );
  }

  static Future<Iterable<String>> _writeRelaysOf(Ndk ndk, String pubkey) async {
    try {
      final published = await ndk.userRelayLists.getSingleUserRelayList(pubkey);
      return published?.writeUrls ?? const [];
    } catch (_) {
      return const [];
    }
  }

  String get pubkey => signer.getPublicKey();

  /// How many ids one filter carries. Relays cap what they accept, and a filter
  /// refused outright would read as "nothing archived" and wrap the lot again.
  static const _idsPerQuery = 100;

  /// Of [ids], the versions this archivist has already preserved, according to
  /// the relays it writes to.
  ///
  /// The local ledger only knows what this crawler still remembers. Asking the
  /// relays is what covers the rest: a data directory that was lost, a volume
  /// recreated, a snapshot published moments before the process died.
  ///
  /// Filtering on the archivist's own pubkey is what makes the answer worth
  /// trusting. An `e` tag is written by whoever publishes the snapshot, so
  /// reading anyone's would let a stranger tag every document in the corpus and
  /// quietly talk this archivist out of ever archiving again. Nobody can sign as
  /// this archivist but this archivist, and NDK checks the signature of what a
  /// relay hands back.
  ///
  /// A relay that says nothing, because it is unreachable or because it never
  /// held the snapshot, reads as "not archived": the cost of asking again is a
  /// duplicate, which readers deduplicate on the wrapped id.
  Future<Set<String>> _archivedByMe(List<String> ids) async {
    final found = <String>{};

    for (var from = 0; from < ids.length; from += _idsPerQuery) {
      final batch = ids.sublist(
        from,
        (from + _idsPerQuery).clamp(0, ids.length),
      );

      final List<Nip01Event> snapshots;
      try {
        snapshots = await ndk.requests
            .query(
              filter: Filter(
                kinds: [snapshotKind],
                authors: [pubkey],
                eTags: batch,
              ),
              explicitRelays: relays,
              // Read past the cache, which the caller already consulted, and
              // write what comes back to it: a ledger lost with its data
              // directory rebuilds itself from the relays on the first pass.
              cacheRead: false,
              timeout: timeout,
            )
            .future;
      } catch (_) {
        continue;
      }

      for (final snapshot in snapshots) {
        final wrapped = snapshot.getFirstTag('e');
        if (wrapped != null) found.add(wrapped);
      }
    }

    return found;
  }

  /// Wraps every event in [events] that nothing preserves yet.
  ///
  /// [alreadyWrapped] holds the ids of the versions the corpus already preserves,
  /// whoever archived them, so two archivists watching the same documents do not
  /// both wrap every version, and a restart does not wrap what the last run did.
  /// What that misses, the relays are asked about: see [_archivedByMe].
  Future<ArchiveReport> archive(
    List<Nip01Event> events, {
    required Set<String> alreadyWrapped,
  }) async {
    final candidates = [
      for (final event in events)
        // An unsigned event is skipped rather than wrapped: a reader discards a
        // snapshot whose content does not verify, and a snapshot nobody counts
        // never makes it back into [alreadyWrapped], so wrapping one would mean
        // publishing it again on every pass for as long as this runs.
        if (event.sig != null && !alreadyWrapped.contains(event.id)) event,
    ];
    if (candidates.isEmpty) return const ArchiveReport();

    final own = await _archivedByMe([for (final it in candidates) it.id]);
    final missing = [
      for (final event in candidates)
        if (!own.contains(event.id)) event,
    ];
    if (missing.isEmpty) return const ArchiveReport();

    final published = <Nip01Event>[];
    for (final event in missing) {
      // Signed here rather than left to the broadcast, which signs into a copy
      // after it has already handed the original to the cache. What would be
      // kept then is an unsigned snapshot: enough to remember the version was
      // archived, not enough for any relay to accept it afterwards.
      final snapshot = await signer.sign(snapshotOf(event, archivist: pubkey));

      try {
        final answers = await ndk.broadcast
            .broadcast(
              nostrEvent: snapshot,
              specificRelays: relays,
              // The cache is the ledger: a snapshot read back next pass is what
              // keeps this from wrapping the same version twice.
              saveToCache: true,
              timeout: timeout,
            )
            .broadcastDoneFuture;

        if (answers.any((answer) => answer.broadcastSuccessful)) {
          published.add(snapshot);
        }
      } catch (_) {
        // A relay that refused or went quiet leaves the version unwrapped, and
        // the next pass tries it again.
      }
    }

    return ArchiveReport(wrapped: missing.length, published: published);
  }
}
