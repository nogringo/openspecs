import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { publicOrigin } from "./origin.server";

const request = (url: string, headers: Record<string, string> = {}) =>
  new Request(url, { headers });

beforeEach(() => {
  vi.stubEnv("OPENSPECS_PUBLIC_URL", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("publicOrigin", () => {
  it("takes the configured origin over anything the request says", () => {
    vi.stubEnv("OPENSPECS_PUBLIC_URL", "https://openspecs.org");
    expect(publicOrigin(request("http://127.0.0.1:3000/spec/npub1/x"))).toBe(
      "https://openspecs.org",
    );
  });

  it("keeps only the origin of a configured value", () => {
    vi.stubEnv("OPENSPECS_PUBLIC_URL", "https://openspecs.org/");
    expect(publicOrigin(request("http://127.0.0.1:3000/"))).toBe("https://openspecs.org");
  });

  it("falls back to the proxy headers rather than to the loopback address", () => {
    const proxied = request("http://127.0.0.1:3000/spec/npub1/x", {
      "x-forwarded-proto": "https",
      "x-forwarded-host": "openspecs.org",
    });
    expect(publicOrigin(proxied)).toBe("https://openspecs.org");
  });

  it("reads the first hop of a chained forwarded header", () => {
    const proxied = request("http://127.0.0.1:3000/", {
      "x-forwarded-proto": "https, http",
      "x-forwarded-host": "openspecs.org, inner.local",
    });
    expect(publicOrigin(proxied)).toBe("https://openspecs.org");
  });

  it("falls back to the request when nothing else is known", () => {
    expect(publicOrigin(request("http://localhost:5173/spec/npub1/x"))).toBe(
      "http://localhost:5173",
    );
  });

  it("ignores a malformed configured value instead of publishing it", () => {
    vi.stubEnv("OPENSPECS_PUBLIC_URL", "openspecs.org");
    expect(publicOrigin(request("http://localhost:5173/"))).toBe("http://localhost:5173");
  });
});
