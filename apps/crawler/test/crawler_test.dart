import 'package:crawler/crawler.dart';
import 'package:ndk/ndk.dart';
import 'package:test/test.dart';

Nip01Event _spec(String content) => Nip01Event(
  pubKey: 'f' * 64,
  kind: specKind,
  tags: const [],
  content: content,
);

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

  group('relays', () {
    test('no relay is listed twice', () {
      expect(sourceRelays.toSet(), hasLength(sourceRelays.length));
      expect(mirrorRelays.toSet(), hasLength(mirrorRelays.length));
    });
  });
}
