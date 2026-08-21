import 'dart:convert';

import 'package:crawler/crawler.dart';
import 'package:ndk/ndk.dart';
import 'package:test/test.dart';

import 'fixtures.dart';

Nip01Event _spec(String content) => Nip01Event(
  pubKey: 'f' * 64,
  kind: specKind,
  tags: const [],
  content: content,
);

/// The tags of [event] with [name] carrying [value] instead, which is how a
/// snapshot that lies about what it holds is built.
List<List<String>> _retagged(Nip01Event event, String name, String value) => [
  for (final tag in event.tags)
    if (tag[0] == name) [name, value] else tag,
];

void main() {
  group('missingOf', () {
    test('hands back the events negentropy asked for, in its order', () {
      final first = _spec('first');
      final second = _spec('second');
      final result = Nip77Result(needIds: [], haveIds: [second.id, first.id]);

      final missing = missingOf(result, {first.id: first, second.id: second});

      expect(missing, [second, first]);
    });

    test('drops an id the cache cannot back with an event', () {
      final known = _spec('known');
      final result = Nip77Result(needIds: [], haveIds: [known.id, 'c' * 64]);

      expect(missingOf(result, {known.id: known}), [known]);
    });
  });

  group('coordinateOf', () {
    test('addresses a document by its identifier', () async {
      final spec = await signedSpec(identifier: 'my-spec');

      expect(coordinateOf(spec), '30817:${spec.pubKey}:my-spec');
    });

    test('leaves the identifier empty for a replaceable kind', () {
      final list = Nip01Event(
        pubKey: 'f' * 64,
        kind: 10002,
        createdAt: 1771547830,
        tags: const [],
        content: '',
      );

      expect(coordinateOf(list), '10002:${'f' * 64}:');
    });

    test('says nothing of a kind relays never replace', () {
      final note = Nip01Event(
        pubKey: 'f' * 64,
        kind: 1,
        createdAt: 1771547830,
        tags: const [],
        content: 'hello',
      );

      expect(coordinateOf(note), isNull);
    });
  });

  group('snapshotOf', () {
    test('tags what it carries, in the order the spec lists', () async {
      final spec = await signedSpec();

      final snapshot = snapshotOf(
        spec,
        archivist: archivist.getPublicKey(),
        createdAt: 1778473064,
      );

      expect(snapshot.kind, snapshotKind);
      expect(snapshot.pubKey, archivist.getPublicKey());
      expect(snapshot.tags, [
        ['e', spec.id],
        ['k', '30817'],
        ['p', spec.pubKey],
        ['a', '30817:${spec.pubKey}:my-spec'],
      ]);
    });

    test('carries the document as the relay served it', () async {
      final spec = await signedSpec();

      final snapshot = snapshotOf(spec, archivist: archivist.getPublicKey());
      final carried = Nip01EventModel.fromJson(json.decode(snapshot.content));

      expect(carried.id, spec.id);
      expect(carried.sig, spec.sig);
      expect(carried.content, spec.content);
      expect(await Bip340EventVerifier().verify(carried), isTrue);
    });

    test('refuses a kind that has nothing to preserve', () {
      final note = Nip01Event(
        pubKey: 'f' * 64,
        kind: 1,
        createdAt: 1771547830,
        tags: const [],
        content: 'hello',
      );

      expect(
        () => snapshotOf(note, archivist: archivist.getPublicKey()),
        throwsArgumentError,
      );
    });
  });

  group('wrappedOf', () {
    final verifier = Bip340EventVerifier();

    Future<Nip01Event> signedSnapshot([Nip01Event? spec]) async =>
        archivist.sign(
          snapshotOf(
            spec ?? await signedSpec(),
            archivist: archivist.getPublicKey(),
            createdAt: 1778473064,
          ),
        );

    test('hands back the document a sound snapshot holds', () async {
      final spec = await signedSpec();

      final wrapped = await wrappedOf(await signedSnapshot(spec), verifier);

      expect(wrapped?.id, spec.id);
    });

    test('discards one whose content is not an event', () async {
      final snapshot = await archivist.sign(
        Nip01Event(
          pubKey: archivist.getPublicKey(),
          kind: snapshotKind,
          createdAt: 1778473064,
          tags: [
            ['e', 'a' * 64],
            ['k', '30817'],
            ['p', 'f' * 64],
            ['a', '30817:${'f' * 64}:my-spec'],
          ],
          content: 'not json at all',
        ),
      );

      expect(await wrappedOf(snapshot, verifier), isNull);
    });

    test('discards one whose tags claim another document', () async {
      final sound = await signedSnapshot();
      final lying = await archivist.sign(
        Nip01Event(
          pubKey: archivist.getPublicKey(),
          kind: snapshotKind,
          createdAt: 1778473064,
          tags: _retagged(sound, 'a', '30817:${'f' * 64}:someone-elses-spec'),
          content: sound.content,
        ),
      );

      expect(await wrappedOf(lying, verifier), isNull);
    });

    test('discards one whose kind tag disagrees with what it holds', () async {
      final sound = await signedSnapshot();
      final lying = await archivist.sign(
        Nip01Event(
          pubKey: archivist.getPublicKey(),
          kind: snapshotKind,
          createdAt: 1778473064,
          tags: _retagged(sound, 'k', '30023'),
          content: sound.content,
        ),
      );

      expect(await wrappedOf(lying, verifier), isNull);
    });

    test('discards one holding a document whose signature is broken', () async {
      final spec = await signedSpec();
      final tampered = Nip01EventModel.fromEntity(spec)
          .copyWith(content: '# Something the author never signed');

      final snapshot = await archivist.sign(
        Nip01Event(
          pubKey: archivist.getPublicKey(),
          kind: snapshotKind,
          createdAt: 1778473064,
          tags: [
            ['e', spec.id],
            ['k', '30817'],
            ['p', spec.pubKey],
            ['a', '30817:${spec.pubKey}:my-spec'],
          ],
          content: Nip01EventModel.fromEntity(tampered).toJsonString(),
        ),
      );

      expect(await wrappedOf(snapshot, verifier), isNull);
    });

    test('discards one holding a kind relays keep anyway', () async {
      final note = await author.sign(
        Nip01Event(
          pubKey: author.getPublicKey(),
          kind: 1,
          createdAt: 1771547830,
          tags: const [],
          content: 'hello',
        ),
      );
      final snapshot = await archivist.sign(
        Nip01Event(
          pubKey: archivist.getPublicKey(),
          kind: snapshotKind,
          createdAt: 1778473064,
          tags: [
            ['e', note.id],
            ['k', '1'],
            ['p', note.pubKey],
            ['a', '1:${note.pubKey}:'],
          ],
          content: Nip01EventModel.fromEntity(note).toJsonString(),
        ),
      );

      expect(await wrappedOf(snapshot, verifier), isNull);
    });
  });

  group('signerFrom', () {
    test('takes an nsec and the same key in hex', () {
      final hex = signerFrom('a' * 64);
      final nsec = signerFrom(Nip19.encodePrivateKey('a' * 64));

      expect(hex?.getPublicKey(), isNotNull);
      expect(nsec?.getPublicKey(), hex?.getPublicKey());
    });

    test('no key means no archivist', () {
      expect(signerFrom(null), isNull);
      expect(signerFrom(''), isNull);
      expect(signerFrom('  '), isNull);
    });

    test('a key that is neither is reported rather than ignored', () {
      expect(() => signerFrom('hunter2'), throwsFormatException);
      expect(
        () => signerFrom(Nip19.encodePubKey('a' * 64)),
        throwsFormatException,
      );
    });
  });

  group('options', () {
    test('an environment listing relays replaces the built in list', () {
      final options = parserFor({
        mirrorsVariable: 'wss://one.example, wss://two.example',
      }).parse([]);

      expect(options.multiOption('mirror'), [
        'wss://one.example',
        'wss://two.example',
      ]);
    });

    test('a variable left empty means the built in list', () {
      final options = parserFor({sourcesVariable: ''}).parse([]);

      expect(options.multiOption('source'), sourceRelays);
    });

    test('an option given wins over the environment', () {
      final options = parserFor({mirrorsVariable: 'wss://one.example'})
          .parse(['--mirror', 'wss://two.example']);

      expect(options.multiOption('mirror'), ['wss://two.example']);
    });

    test('relaysFrom takes commas and spaces alike', () {
      expect(relaysFrom('wss://a wss://b,wss://c'), [
        'wss://a',
        'wss://b',
        'wss://c',
      ]);
      expect(relaysFrom(null), isNull);
      expect(relaysFrom(' , '), isNull);
    });
  });

  group('relays', () {
    test('no relay is listed twice', () {
      expect(sourceRelays.toSet(), hasLength(sourceRelays.length));
      expect(mirrorRelays.toSet(), hasLength(mirrorRelays.length));
    });
  });
}
