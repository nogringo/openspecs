import 'dart:async';
import 'dart:io';

import 'package:args/args.dart';
import 'package:crawler/crawler.dart';
import 'package:ndk/ndk.dart';
import 'package:path/path.dart' as p;
import 'package:sembast/sembast_io.dart' hide Filter;

Future<void> main(List<String> arguments) async {
  final parser = parserFor(Platform.environment);

  final ArgResults options;
  try {
    options = parser.parse(arguments);
  } on FormatException catch (error) {
    stderr.writeln('${error.message}\n\n${parser.usage}');
    exitCode = 64;
    return;
  }

  if (options.flag('help')) {
    stdout.writeln(parser.usage);
    return;
  }

  final seconds = _seconds(options);
  if (seconds == null) {
    exitCode = 64;
    return;
  }
  final (interval, timeout) = seconds;

  final EventSigner? signer;
  try {
    signer = signerFrom(Platform.environment[archivistKeyVariable]);
  } on FormatException catch (error) {
    stderr.writeln('$archivistKeyVariable: ${error.message}');
    exitCode = 64;
    return;
  }

  final dataDir = options.option('data')!;
  await Directory(dataDir).create(recursive: true);

  final db = await databaseFactoryIo.openDatabase(
    p.join(dataDir, 'sync_engine.db'),
  );
  final cache = await SembastCacheManager.create(databasePath: dataDir);
  final sources = options.multiOption('source');
  final mirrors = options.multiOption('mirror');
  final everyRelay = {...sources, ...mirrors}.toList();

  final ndk = Ndk(
    NdkConfig(
      eventVerifier: Bip340EventVerifier(),
      cache: cache,
      // The relays every lookup this app does not aim itself falls back to,
      // which is only the archivist's relay list. Both lists: an archivist
      // announces itself wherever it writes, and that is as often its own
      // relay, which is a mirror, as the ones it reads from.
      bootstrapRelays: everyRelay,
    ),
  );

  final archivist = signer == null
      ? null
      : await Archivist.resolve(
          ndk,
          signer: signer,
          relays: everyRelay,
          timeout: timeout,
        );

  final crawler = Crawler(
    ndk,
    db: db,
    cache: cache,
    sources: sources,
    mirrors: mirrors,
    archivist: archivist,
    interval: interval,
    timeout: timeout,
    onProgress: (progress) => _say(
      '${_host(progress.relayUrl)} gave ${progress.eventCount} '
      'down to ${progress.from.toIso8601String()}',
    ),
    onPass: (phase) => _say(
      phase == SyncRequestPhase.failed
          ? 'no source relay answered, retrying'
          : 'sources read',
    ),
    onMirror: (report) => _say('${_host(report.relay)}: ${_outcome(report)}'),
    onArchive: (report) => _say(
      '${report.published.length} of ${report.wrapped} versions archived',
    ),
  );

  _say(
    'reading ${sources.length} relays, '
    'copying to ${mirrors.length}, '
    'every ${interval.inSeconds}s',
  );
  if (archivist != null) {
    _say(
      'archiving versions as ${Nip19.encodePubKey(archivist.pubkey)} '
      'to ${archivist.relays.length} relays',
    );
  }
  crawler.start();

  await _untilStopped();

  _say('stopping');
  await crawler.stop();
  await db.close();
  ndk.destroy();
}

/// Both durations are read together so a bad one is reported before anything is
/// opened on disk or on the network.
(Duration, Duration)? _seconds(ArgResults options) {
  final interval = int.tryParse(options.option('interval')!);
  final timeout = int.tryParse(options.option('timeout')!);

  if (interval == null || interval <= 0) {
    stderr.writeln('interval must be a number of seconds');
    return null;
  }
  if (timeout == null || timeout <= 0) {
    stderr.writeln('timeout must be a number of seconds');
    return null;
  }

  return (Duration(seconds: interval), Duration(seconds: timeout));
}

/// A relay that was already up to date says so, which is the ordinary case once
/// the first pass is done and the only way to tell silence from a mirror that
/// simply had nothing to receive.
String _outcome(MirrorReport report) {
  final error = report.error;
  if (error != null) return 'left for later, $error';
  if (report.missing == 0) return 'up to date';
  return '${report.sent} of ${report.missing} sent';
}

String _host(String relayUrl) => Uri.tryParse(relayUrl)?.host ?? relayUrl;

void _say(String line) =>
    stdout.writeln('${DateTime.now().toIso8601String()} $line');

/// Ctrl-C and the signal a supervisor sends both mean the same thing: put the
/// walk down cleanly rather than leave a half written page behind.
Future<void> _untilStopped() {
  final stopped = Completer<void>();

  void stop(ProcessSignal _) {
    if (!stopped.isCompleted) stopped.complete();
  }

  final listening = [
    ProcessSignal.sigint.watch().listen(stop),
    if (!Platform.isWindows) ProcessSignal.sigterm.watch().listen(stop),
  ];

  return stopped.future.whenComplete(
    () => Future.wait(listening.map((it) => it.cancel())),
  );
}
