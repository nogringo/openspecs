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
