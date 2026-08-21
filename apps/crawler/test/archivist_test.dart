import 'package:crawler/crawler.dart';
import 'package:ndk/entities.dart';
import 'package:ndk/ndk.dart';
import 'package:ndk/shared/nips/nip01/key_pair.dart';
import 'package:test/test.dart';

import 'fixtures.dart';
import 'mocks/mock_relay.dart';

void main() {
  late MockRelay relay;
  late CacheManager cache;
  late Ndk ndk;

  setUp(() async {
    relay = MockRelay(name: 'archive');
    await relay.startServer();

    cache = MemCacheManager();
    ndk = Ndk(
      NdkConfig(
        eventVerifier: Bip340EventVerifier(),
        cache: cache,
        bootstrapRelays: [relay.url],
      ),
    );
  });

  tearDown(() async {
    ndk.destroy();
    await relay.stopServer();
  });

  List<Nip01Event> snapshotsAt(MockRelay relay) => [
    for (final event in relay.receivedEvents)
      if (event.kind == snapshotKind) event,
  ];

  test('publishes a snapshot a reader can check for itself', () async {
    final spec = await signedSpec();
    final archiving = Archivist(
      ndk,
      signer: archivist,
      relays: [relay.url],
      timeout: const Duration(seconds: 5),
    );

    final report = await archiving.archive([spec], alreadyWrapped: const {});

    expect(report.wrapped, 1);
    expect(report.published, hasLength(1));

    final published = snapshotsAt(relay);
    expect(published, hasLength(1));
    expect(published.single.pubKey, archivist.getPublicKey());

    // The relay verified the outer signature to accept it at all. What matters
    // here is the inner one: the version it preserves still proves its author.
    final wrapped = await wrappedOf(published.single, Bip340EventVerifier());
    expect(wrapped?.id, spec.id);
    expect(wrapped?.pubKey, author.getPublicKey());
  });

  test('keeps a signed copy, which is what the next pass reads', () async {
    final spec = await signedSpec();
    final archiving = Archivist(ndk, signer: archivist, relays: [relay.url]);

    await archiving.archive([spec], alreadyWrapped: const {});

    // The cache is the ledger, so what it kept has to be a snapshot in full: an
    // unsigned one would still say the version was archived, and then fail
    // every relay it was offered to afterwards.
    final kept = await cache.loadEvents(kinds: [snapshotKind]);
    expect(kept, hasLength(1));
    expect(kept.single.sig, isNotNull);
    expect(await wrappedOf(kept.single, Bip340EventVerifier()), isNotNull);

    // Which closes the loop: read back, it covers the version it preserves.
    final second = await archiving.archive(
      [spec],
      alreadyWrapped: {for (final it in kept) ?it.getFirstTag('e')},
    );
    expect(second.wrapped, 0);
  });

  test('asks the relays about what its ledger no longer knows', () async {
    final spec = await signedSpec();
    await Archivist(
      ndk,
      signer: archivist,
      relays: [relay.url],
    ).archive([spec], alreadyWrapped: const {});
    expect(snapshotsAt(relay), hasLength(1));

    // The data directory is gone, so a fresh crawler remembers nothing. The
    // relays still hold what it archived, and that is the ledger it rebuilds.
    final restarted = Ndk(
      NdkConfig(
        eventVerifier: Bip340EventVerifier(),
        cache: MemCacheManager(),
        bootstrapRelays: [relay.url],
      ),
    );
    addTearDown(restarted.destroy);

    final report = await Archivist(
      restarted,
      signer: archivist,
      relays: [relay.url],
      timeout: const Duration(seconds: 5),
    ).archive([spec], alreadyWrapped: const {});

    expect(report.wrapped, 0);
    expect(snapshotsAt(relay), hasLength(1));
  });

  test('wraps a version another archivist signed for', () async {
    final spec = await signedSpec();
    final stranger = signerWith('c' * 64);

    // Somebody else's snapshot of the same version, which is not this
    // archivist's answer for whether it archived one: an `e` tag costs nothing
    // to write, and trusting anyone's would be a way to talk an archivist out
    // of archiving at all.
    await Archivist(
      ndk,
      signer: stranger,
      relays: [relay.url],
    ).archive([spec], alreadyWrapped: const {});

    final report = await Archivist(
      ndk,
      signer: archivist,
      relays: [relay.url],
      timeout: const Duration(seconds: 5),
    ).archive([spec], alreadyWrapped: const {});

    expect(report.wrapped, 1);
    expect(snapshotsAt(relay), hasLength(2));
  });

  test('skips an event no reader could verify', () async {
    final unsigned = Nip01Event(
      pubKey: author.getPublicKey(),
      kind: specKind,
      createdAt: 1771547830,
      tags: [
        ['d', 'my-spec'],
      ],
      content: '# My Spec',
    );
    final archiving = Archivist(ndk, signer: archivist, relays: [relay.url]);

    final report = await archiving.archive([
      unsigned,
    ], alreadyWrapped: const {});

    // Wrapping it would publish a snapshot every reader discards, which never
    // makes it back into the ledger, which means publishing it again forever.
    expect(report.wrapped, 0);
    expect(snapshotsAt(relay), isEmpty);
  });

  test('leaves a version somebody already preserved alone', () async {
    final spec = await signedSpec();
    final archiving = Archivist(ndk, signer: archivist, relays: [relay.url]);

    final report = await archiving.archive([spec], alreadyWrapped: {spec.id});

    expect(report.wrapped, 0);
    expect(snapshotsAt(relay), isEmpty);
  });

  test('preserves each revision of a document as it appears', () async {
    final first = await signedSpec(content: '# First', createdAt: 1771547830);
    final second = await signedSpec(content: '# Second', createdAt: 1771547900);
    final archiving = Archivist(ndk, signer: archivist, relays: [relay.url]);

    Future<void> publish(Nip01Event spec) => ndk.broadcast
        .broadcast(nostrEvent: spec, specificRelays: [relay.url])
        .broadcastDoneFuture;

    await publish(first);
    final before = await archiving.archive([first], alreadyWrapped: const {});

    // The author rewrites it, and the relay drops what it said before: that is
    // the loss this whole thing exists to answer.
    await publish(second);
    final after = await archiving.archive(
      [second],
      alreadyWrapped: {for (final it in before.published) ?it.getFirstTag('e')},
    );

    expect(after.wrapped, 1);
    expect(snapshotsAt(relay), hasLength(2));

    final live = relay.matchingEvents(Filter(kinds: [specKind]));
    expect(live, hasLength(1));
    expect(live.single.content, '# Second');

    // The query the spec gives for reading a history back.
    final preserved = await ndk.requests
        .query(
          filter: Filter(
            kinds: [snapshotKind],
            aTags: ['30817:${first.pubKey}:my-spec'],
          ),
          explicitRelays: [relay.url],
          cacheRead: false,
          cacheWrite: false,
        )
        .future;
    expect(preserved, hasLength(2));

    final revisions = [
      for (final snapshot in preserved)
        (await wrappedOf(snapshot, Bip340EventVerifier()))!,
    ]..sort((a, b) => a.createdAt.compareTo(b.createdAt));
    expect([for (final it in revisions) it.content], ['# First', '# Second']);
  });

  test('adds the relays the archivist says it writes to', () async {
    // Its own relay: the list has to be there before NDK is pointed at it, and
    // the mock only signs one it holds a private key for.
    final announcing = MockRelay(name: 'announcing');
    await announcing.startServer(
      nip65s: {
        KeyPair(archivistKey, archivist.getPublicKey(), null, null): Nip65(
          pubKey: archivist.getPublicKey(),
          relays: {
            'wss://announced.example': ReadWriteMarker.readWrite,
            'wss://reading.example': ReadWriteMarker.readOnly,
          },
          createdAt: 1778473064,
        ),
      },
    );

    final reading = Ndk(
      NdkConfig(
        eventVerifier: Bip340EventVerifier(),
        cache: MemCacheManager(),
        bootstrapRelays: [announcing.url],
      ),
    );
    addTearDown(() async {
      reading.destroy();
      await announcing.stopServer();
    });

    final archiving = await Archivist.resolve(
      reading,
      signer: archivist,
      relays: [announcing.url],
      timeout: const Duration(seconds: 5),
    );

    expect(archiving.relays, contains(announcing.url));
    expect(
      archiving.relays.any((it) => it.contains('announced.example')),
      isTrue,
    );
    expect(
      archiving.relays.any((it) => it.contains('reading.example')),
      isFalse,
    );
  });
}
