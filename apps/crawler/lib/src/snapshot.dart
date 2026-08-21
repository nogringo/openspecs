import 'dart:convert';

import 'package:ndk/ndk.dart';

/// Kind of a snapshot, the regular event that preserves one version of a
/// replaceable or addressable event by carrying it in its `content`.
///
/// From `replaceable-event-snapshots`, published on Open Specs itself.
const snapshotKind = 1349;

/// The coordinate a snapshot points at, or null when [event] is of a kind that
/// relays do not replace and so has nothing to preserve.
///
/// Kinds 10000 to 19999 are replaceable rather than addressable: they have no
/// `d` tag, and the spec asks for the coordinate all the same, with the
/// identifier left empty.
String? coordinateOf(Nip01Event event) {
  final kind = event.kind;
  final addressable = kind >= 30000 && kind < 40000;
  final replaceable = kind == 0 || kind == 3 || (kind >= 10000 && kind < 20000);

  if (!addressable && !replaceable) return null;

  final identifier = addressable ? event.getDtag() ?? '' : '';
  return '$kind:${event.pubKey}:$identifier';
}

/// The snapshot preserving [event], unsigned and left for the archivist to sign.
///
/// `content` is the wrapped event serialized the way relays serve it, so the
/// signature it already carries keeps verifying once it is read back out.
///
/// Throws when [event] is of a kind relays do not replace: wrapping one would
/// archive a version that was never at risk of being overwritten.
Nip01Event snapshotOf(
  Nip01Event event, {
  required String archivist,
  int createdAt = 0,
}) {
  final coordinate = coordinateOf(event);
  if (coordinate == null) {
    throw ArgumentError.value(
      event.kind,
      'event.kind',
      'not a replaceable or addressable kind',
    );
  }

  return Nip01Event(
    pubKey: archivist,
    kind: snapshotKind,
    // Passed rather than left to default: the entity computes its id from the
    // argument, not from the timestamp it falls back to, so an event built
    // without one is signed over a `created_at` it does not carry.
    createdAt: createdAt == 0 ? Nip01Event.secondsSinceEpoch() : createdAt,
    tags: [
      ['e', event.id],
      ['k', '${event.kind}'],
      ['p', event.pubKey],
      ['a', coordinate],
    ],
    content: Nip01EventModel.fromEntity(event).toJsonString(),
  );
}

/// The event [snapshot] preserves, or null when it preserves nothing a reader
/// should trust.
///
/// The tags are written by the publisher, who may be anyone, so a snapshot whose
/// tags disagree with what it carries is discarded rather than believed: without
/// this, anyone could attach arbitrary events to another document's history.
Future<Nip01Event?> wrappedOf(
  Nip01Event snapshot,
  EventVerifier verifier,
) async {
  if (snapshot.kind != snapshotKind) return null;

  final Nip01Event wrapped;
  try {
    final decoded = json.decode(snapshot.content);
    if (decoded is! Map) return null;
    wrapped = Nip01EventModel.fromJson(decoded);
  } catch (_) {
    return null;
  }

  final coordinate = coordinateOf(wrapped);
  if (coordinate == null) return null;

  if (snapshot.getFirstTag('e') != wrapped.id ||
      snapshot.getFirstTag('k') != '${wrapped.kind}' ||
      snapshot.getFirstTag('p') != wrapped.pubKey ||
      snapshot.getFirstTag('a') != coordinate) {
    return null;
  }

  // Covers the id as well as the signature: a verifier recomputes the id before
  // checking what was signed over it.
  if (!await verifier.verify(wrapped)) return null;

  return wrapped;
}
