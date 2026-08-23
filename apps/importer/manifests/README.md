# Manifests

One file per corpus. Each lists every document to import, and carries everything the
importer cannot read from the document itself.

The importer is a pure function of these files and the source repository. Nothing here is
computed at run time, so two runs at the same commits produce the same events, and a
third party can rebuild the corpus and compare it byte for byte.

## Fields

| Field     | Meaning                                                            |
| --------- | ------------------------------------------------------------------ |
| `file`    | Path in the source repository                                       |
| `d`       | Identifier of the addressable event, and the last part of its URL   |
| `title`   | `title` tag                                                        |
| `status`  | `s` tag, or null when the document claims none                     |
| `summary` | `summary` tag                                                      |
| `kinds`   | `k` tags, omitted when the document defines none                   |

`topics` is declared once per corpus and applies to every document in it.

## How these values were chosen

**The title carries the number.** A listing row shows the title alone, and nobody looks
for "Basic protocol flow description". `NIP-01: Basic protocol flow description`.

**Status uses each corpus's own vocabulary**, read from the badge line under the heading:
`draft`, `final`, `unrecommended` for NIPs, `draft` for BUDs, `mandatory` or `optional`
for NUTs. A document with no badge gets null rather than a guess. The NIPs marked
`unrecommended` are those struck through in the repository's own index, which is where
that judgement is made and the only place it is written down.

The site colours `draft`, `final` and the closed states, but not `unrecommended`. Adding
it to `STATUS_TONE` in `spec-tags.tsx` is a one line change, and until then those
documents render neutral.

**Kinds come from the tables the repositories maintain**, the event kinds table in the
NIPs index and the one in the Blossom readme. Only kinds a document actually defines are
listed: NUT-27 carries 30078 because it specifies how that kind is used, and the other
NUTs carry none.

**Summaries are written here rather than derived.** The site can take a description from
the first paragraph, but that paragraph is written for a reader who already knows what
the document is.

## Membership

These files are the whole truth about what exists. `nips.json` holds 94 documents where
the repository has 98 files: `12.md`, `16.md`, `20.md` and `33.md` were folded into
NIP-01 and dropped from the index, so they are gone from here too. Files that are not
specifications, `error_codes.md` and `suppl/` in the NUTs repository among them, are
absent for the same reason.

A new specification appears when a line is added. Removing one withdraws the document,
by publishing an empty revision over it. Neither happens on its own, which is the point:
both are a diff somebody read.
