import 'package:crawler/crawler.dart';
import 'package:ndk/ndk.dart';

/// Whoever writes the documents under test. Signing them for real is what makes
/// the validation tests worth anything: a snapshot is only accepted when the
/// event it carries verifies.
final author = signerWith('a' * 64);

/// Whoever archives them, which is deliberately not the author: a snapshot
/// proves who archived a version, never who wrote it.
final archivistKey = 'b' * 64;
final archivist = signerWith(archivistKey);

EventSigner signerWith(String privateKey) =>
    const Bip340EventSignerFactory().create(privateKey: privateKey);

/// A signed document, the way a relay serves it.
///
/// `createdAt` is always given: NDK computes an event's id from the argument
/// rather than from the timestamp it falls back to, so an event built without
/// one carries an id that does not match its own `created_at`.
Future<Nip01Event> signedSpec({
  EventSigner? signer,
  String identifier = 'my-spec',
  String content = '# My Spec',
  int createdAt = 1771547830,
}) {
  final by = signer ?? author;

  return by.sign(
    Nip01Event(
      pubKey: by.getPublicKey(),
      kind: specKind,
      createdAt: createdAt,
      tags: [
        ['d', identifier],
      ],
      content: content,
    ),
  );
}
