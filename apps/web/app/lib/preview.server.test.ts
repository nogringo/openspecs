import { describe, expect, it } from "vitest";
import { isReachable } from "./preview.server";

/**
 * Only the answers that need no name resolution: a test that queried DNS would
 * depend on a network, and these are the cases that matter anyway.
 */
describe("isReachable", () => {
  it("refuses an address on this machine or its network", async () => {
    for (const host of ["127.0.0.1", "[::1]", "10.0.0.1", "169.254.169.254", "[fd00::1]"]) {
      expect(await isReachable(host), host).toBe(false);
    }
  });

  it("refuses a name that resolves inside the network by convention", async () => {
    for (const host of ["localhost", "printer.local", "intranet"]) {
      expect(await isReachable(host), host).toBe(false);
    }
  });

  it("allows a public address written as a literal", async () => {
    expect(await isReachable("1.1.1.1")).toBe(true);
  });
});
