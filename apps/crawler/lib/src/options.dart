import 'package:args/args.dart';

import 'relays.dart';

/// Where a deployment names the relays it walks. The environment rather than
/// the command line, because the file an operator edits is their own `.env`,
/// while the compose file naming the options is one this repository ships and
/// updates under them.
const sourcesVariable = 'OPENSPECS_CRAWLER_SOURCES';
const mirrorsVariable = 'OPENSPECS_CRAWLER_MIRRORS';

/// The command line, with [environment] deciding what the relay options fall
/// back to.
///
/// An option given on the command line still wins: the environment only moves
/// the defaults, which is also what `--help` then prints.
ArgParser parserFor(Map<String, String> environment) => ArgParser()
  ..addMultiOption(
    'source',
    abbr: 's',
    valueHelp: 'url',
    help: 'Relay to read documents from.',
    defaultsTo: relaysFrom(environment[sourcesVariable]) ?? sourceRelays,
  )
  ..addMultiOption(
    'mirror',
    abbr: 'm',
    valueHelp: 'url',
    help: 'Relay to copy documents to.',
    defaultsTo: relaysFrom(environment[mirrorsVariable]) ?? mirrorRelays,
  )
  ..addOption(
    'data',
    abbr: 'd',
    valueHelp: 'dir',
    help: 'Where the cache and the sync state live.',
    defaultsTo: '.crawler',
  )
  ..addOption(
    'interval',
    abbr: 'i',
    valueHelp: 'seconds',
    help: 'How long between two looks at the source relays.',
    defaultsTo: '300',
  )
  ..addOption(
    'timeout',
    abbr: 't',
    valueHelp: 'seconds',
    help: 'How long a relay may take to answer before it is left for later.',
    defaultsTo: '30',
  )
  ..addFlag('help', abbr: 'h', negatable: false, help: 'Show this usage.');

/// The relays a variable lists, separated by commas or spaces.
///
/// Null when the variable says nothing, which a variable declared and left
/// empty does too: compose passes those through as empty strings, and an
/// operator who cleared a line meant the built in list, not no relay at all.
List<String>? relaysFrom(String? value) {
  final relays = [
    for (final relay in (value ?? '').split(RegExp(r'[,\s]+')))
      if (relay.isNotEmpty) relay,
  ];

  return relays.isEmpty ? null : relays;
}
