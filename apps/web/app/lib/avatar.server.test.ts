import { afterEach, describe, expect, it, vi } from "vitest";
import { loadAvatar } from "./avatar.server";

/**
 * Every address is a public literal, so nothing here resolves a name, and every
 * test uses its own so the cache never answers for another.
 */
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

const served = (body: BodyInit | null, init: ResponseInit) =>
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, init)));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("loadAvatar", () => {
  it("carries a drawable picture as bytes, so nothing else has to fetch it", async () => {
    served(png, { headers: { "content-type": "image/png" } });

    const avatar = await loadAvatar("https://1.1.1.1/a.png");
    expect(avatar.uri).toBe(`data:image/png;base64,${Buffer.from(png).toString("base64")}`);
  });

  it("leaves a format the renderer would draw as a hole to the key mark", async () => {
    served(png, { headers: { "content-type": "image/webp" } });

    expect(await loadAvatar("https://1.1.1.1/b.webp")).toEqual({ uri: null, retry: false });
  });

  it("refuses a picture that announces itself as too large, before reading it", async () => {
    served(png, {
      headers: { "content-type": "image/png", "content-length": String(8 * 1024 * 1024) },
    });

    expect(await loadAvatar("https://1.1.1.1/c.png")).toEqual({ uri: null, retry: false });
  });

  it("refuses one that passes the bound while being read, rather than truncating it", async () => {
    served(new Uint8Array(3 * 1024 * 1024), { headers: { "content-type": "image/png" } });

    expect((await loadAvatar("https://1.1.1.1/d.png")).uri).toBeNull();
  });

  it("does not let a redirect undo the rule the first hop was held to", async () => {
    served(null, { status: 301, headers: { location: "http://1.1.1.1/e.png" } });

    expect(await loadAvatar("https://1.1.1.1/e.png")).toEqual({ uri: null, retry: false });
  });

  it("refuses to ask a host on this server's own network", async () => {
    served(png, { headers: { "content-type": "image/png" } });

    expect(await loadAvatar("https://127.0.0.1/f.png")).toEqual({ uri: null, retry: true });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("comes back to a host that failed to answer, and not to an answer it got", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("timed out")));

    expect(await loadAvatar("https://1.1.1.1/g.png")).toEqual({ uri: null, retry: true });
  });

  it("asks for nothing at all when the author published no picture", async () => {
    served(png, { headers: { "content-type": "image/png" } });

    expect(await loadAvatar(null)).toEqual({ uri: null, retry: false });
    expect(await loadAvatar("")).toEqual({ uri: null, retry: false });
    expect(fetch).not.toHaveBeenCalled();
  });
});
