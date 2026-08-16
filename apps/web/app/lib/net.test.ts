import { describe, expect, it } from "vitest";
import { isPrivateAddress } from "./net";

describe("isPrivateAddress", () => {
  it("refuses the machine itself and the network around it", () => {
    for (const address of [
      "127.0.0.1",
      "127.1.2.3",
      "0.0.0.0",
      "10.0.0.1",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "100.64.0.1",
      "224.0.0.1",
      "255.255.255.255",
    ]) {
      expect(isPrivateAddress(address), address).toBe(true);
    }
  });

  it("refuses the link local range, where cloud metadata services answer", () => {
    expect(isPrivateAddress("169.254.169.254")).toBe(true);
  });

  it("refuses the same addresses written as IPv6", () => {
    for (const address of ["::1", "::", "[::1]", "fc00::1", "fd12:3456::1", "fe80::1", "ff02::1"]) {
      expect(isPrivateAddress(address), address).toBe(true);
    }
    expect(isPrivateAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isPrivateAddress("::ffff:169.254.169.254")).toBe(true);
  });

  it("allows an address on the public internet", () => {
    for (const address of ["1.1.1.1", "8.8.8.8", "172.32.0.1", "192.169.0.1", "2606:4700::1111"]) {
      expect(isPrivateAddress(address), address).toBe(false);
    }
  });

  it("refuses anything it cannot read as an address", () => {
    for (const value of ["", "localhost", "999.1.1.1", "1.2.3", "nonsense"]) {
      expect(isPrivateAddress(value), value).toBe(true);
    }
  });
});
