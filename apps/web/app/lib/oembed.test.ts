import { describe, expect, it } from "vitest";
import { parseSpecUrl } from "./oembed";

const ORIGIN = "https://openspecs.org";
const NPUB = "npub1q3sle0kvfsehgsuexttt3ugjd8xdklxfwwkh559wxckmzddywnws6cd26p";

describe("parseSpecUrl", () => {
  it("reads the document out of its own URL", () => {
    expect(parseSpecUrl(`${ORIGIN}/spec/${NPUB}/nips-on-nostr`, ORIGIN)).toEqual({
      npub: NPUB,
      identifier: "nips-on-nostr",
    });
  });

  it("decodes an identifier that needed encoding", () => {
    expect(parseSpecUrl(`${ORIGIN}/spec/${NPUB}/stele%3Aspace%3Adocs`, ORIGIN)?.identifier).toBe(
      "stele:space:docs",
    );
    expect(parseSpecUrl(`${ORIGIN}/spec/${NPUB}/a%2Fb`, ORIGIN)?.identifier).toBe("a/b");
  });

  it("ignores the query and the fragment a consumer may have kept", () => {
    expect(parseSpecUrl(`${ORIGIN}/spec/${NPUB}/nip-01?utm=x#motivation`, ORIGIN)).toEqual({
      npub: NPUB,
      identifier: "nip-01",
    });
  });

  it("answers for no origin but its own", () => {
    expect(parseSpecUrl(`https://elsewhere.example/spec/${NPUB}/x`, ORIGIN)).toBeNull();
  });

  it("answers for no page but a document", () => {
    for (const url of [
      `${ORIGIN}/`,
      `${ORIGIN}/specs?topic=nostr`,
      `${ORIGIN}/spec/${NPUB}`,
      `${ORIGIN}/spec/${NPUB}/`,
      `${ORIGIN}/spec/alice@example.com/x`,
      "not a url",
    ]) {
      expect(parseSpecUrl(url, ORIGIN), url).toBeNull();
    }
  });
});
