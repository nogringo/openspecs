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

  /// Events negentropy said the relay does not have.
  final int missing;

  /// Events the relay answered `OK` for.
  final int sent;

  /// Set when the reconciliation never happened: no NIP-77, no connection, or
  /// a timeout. The relay is simply left alone until the next pass.
  final Object? error;
}

/// The events [result] reported as missing, in the order negentropy gave them.
/// An id without an event is dropped rather than faked: the cache is the only
/// place the bytes can come from.
List<Nip01Event> missingOf(Nip77Result result, Map<String, Nip01Event> byId) =>
    [for (final id in result.haveIds) ?byId[id]];

/// Copies documents to one relay, sending only what it turns out to lack.
///
/// Negentropy settles which ids are missing in a couple of round trips, whatever
/// the size of the corpus. It only reconciles ids though, so the events
/// themselves still travel as ordinary `EVENT` messages afterwards. They carry
/// their signature from the day they were written, so no key and no account is
/// involved in copying them.
///
/// [kinds] has to match what [events] holds: negentropy compares the relay's
/// answer to that filter against the ids given, so a kind left out of it turns
/// every event of that kind into one the relay looks like it is missing.
Future<MirrorReport> mirrorTo(
  Ndk ndk,
  String relay,
  List<Nip01Event> events, {
  List<int> kinds = const [specKind],
  Duration timeout = const Duration(seconds: 30),
}) async {
  final byId = {for (final event in events) event.id: event};

  final Nip77Result result;
  try {
    // ignore: experimental_member_use
    result = await ndk.nip77
        .reconcile(
          relayUrl: relay,
          filter: Filter(kinds: kinds),
          localIds: byId.keys.toList(),
          timeout: timeout,
        )
        .future;
  } catch (error) {
    return MirrorReport(relay: relay, error: error);
  }

  final missing = missingOf(result, byId);

  var sent = 0;
  for (final event in missing) {
    final answers = await ndk.broadcast
        .broadcast(
          nostrEvent: event,
          specificRelays: [relay],
          saveToCache: false,
          timeout: timeout,
        )
        .broadcastDoneFuture;
    if (answers.any((answer) => answer.broadcastSuccessful)) sent++;
  }

  return MirrorReport(relay: relay, missing: missing.length, sent: sent);
}
