import { describe, expect, it } from "vitest";
import { parsePreview } from "./preview";

const URL_UNDER_TEST = "https://www.example.org/nips/47";

describe("parsePreview", () => {
  it("prefers what a page says about itself to what it puts in the tab", () => {
    const html = `<head><title>Tab</title>
      <meta property="og:title" content="Nostr Wallet Connect">
      <meta property="og:description" content="Remote signing over relays.">
    </head>`;
    expect(parsePreview(html, URL_UNDER_TEST)).toEqual({
      url: URL_UNDER_TEST,
      host: "example.org",
      title: "Nostr Wallet Connect",
      description: "Remote signing over relays.",
    });
  });

  it("falls back to the title element, and to no description at all", () => {
    const preview = parsePreview("<html><head><title>Just a page</title></head>", URL_UNDER_TEST);
    expect(preview?.title).toBe("Just a page");
    expect(preview?.description).toBe("");
  });

  it("reads a meta tag whichever order its attributes are in", () => {
    const html = '<meta content="Written backwards" property="og:title">';
    expect(parsePreview(html, URL_UNDER_TEST)?.title).toBe("Written backwards");
  });

  it("decodes entities and collapses the whitespace of a wrapped title", () => {
    const html = "<title>Tags &amp; keys\n   in&nbsp;specs &#38; more</title>";
    expect(parsePreview(html, URL_UNDER_TEST)?.title).toBe("Tags & keys in specs & more");
  });

  it("bounds what a page can put on the card", () => {
    const html = `<title>${"x".repeat(400)}</title>`;
    expect(parsePreview(html, URL_UNDER_TEST)?.title).toHaveLength(120);
  });

  it("gives up on a page that names itself nowhere", () => {
    expect(parsePreview("<html><body>No head at all</body></html>", URL_UNDER_TEST)).toBeNull();
  });

  it("gives up on something that is not a URL", () => {
    expect(parsePreview("<title>x</title>", "not a url")).toBeNull();
  });
});
