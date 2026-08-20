import 'package:ndk/ndk.dart';

import 'relays.dart';

/// What one relay was missing, and what it accepted.
class MirrorReport {
  const MirrorReport({
    required this.relay,
    this.missing = 0,
    this.sent = 0,
    this.error,
  });

  final String relay;

  /// Documents negentropy said the relay does not have.
  final int missing;

  /// Documents the relay answered `OK` for.
  final int sent;

  /// Set when the reconciliation never happened: no NIP-77, no connection, or
  /// a timeout. The relay is simply left alone until the next pass.
  final Object? error;
}

/// The documents [result] reported as missing, in the order negentropy gave
/// them. An id without an event is dropped rather than faked: the cache is the
/// only place the bytes can come from.
List<Nip01Event> missingOf(Nip77Result result, Map<String, Nip01Event> byId) =>
    [for (final id in result.haveIds) ?byId[id]];

/// Copies documents to one relay, sending only what it turns out to lack.
///
/// Negentropy settles which ids are missing in a couple of round trips, whatever
/// the size of the corpus. It only reconciles ids though, so the events
/// themselves still travel as ordinary `EVENT` messages afterwards. They carry
/// their author's signature from the day they were written, so no key and no
/// account is involved in copying them.
Future<MirrorReport> mirrorTo(
  Ndk ndk,
  String relay,
  List<Nip01Event> specs, {
  Duration timeout = const Duration(seconds: 30),
}) async {
  final byId = {for (final spec in specs) spec.id: spec};

  final Nip77Result result;
  try {
    // ignore: experimental_member_use
    result = await ndk.nip77
        .reconcile(
          relayUrl: relay,
          filter: Filter(kinds: [specKind]),
          localIds: byId.keys.toList(),
          timeout: timeout,
        )
        .future;
  } catch (error) {
    return MirrorReport(relay: relay, error: error);
  }

  final missing = missingOf(result, byId);

  var sent = 0;
  for (final spec in missing) {
    final answers = await ndk.broadcast
        .broadcast(
          nostrEvent: spec,
          specificRelays: [relay],
          saveToCache: false,
          timeout: timeout,
        )
        .broadcastDoneFuture;
    if (answers.any((answer) => answer.broadcastSuccessful)) sent++;
  }

  return MirrorReport(relay: relay, missing: missing.length, sent: sent);
}
