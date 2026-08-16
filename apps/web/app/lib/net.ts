const v4 = (address: string): number[] | null => {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  const octets = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : -1));
  return octets.every((octet) => octet >= 0 && octet <= 255) ? octets : null;
};

/**
 * Addresses this server must never be talked into reaching. A document is
 * written by anyone, so a link inside it can point at the machine serving it,
 * at the network around it, or at a cloud metadata service, and the answer
 * would come back to the reader as a preview.
 */
export const isPrivateAddress = (address: string): boolean => {
  const value = address
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "");

  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(value);
  const octets = v4(mapped?.[1] ?? value);
  if (octets) {
    const [a = 0, b = 0] = octets;
    return (
      a === 0 || // this network
      a === 10 ||
      a === 127 || // loopback
      (a === 100 && b >= 64 && b <= 127) || // carrier grade nat
      (a === 169 && b === 254) || // link local, where metadata services live
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) || // ietf protocol assignments
      (a === 198 && b >= 18 && b <= 19) || // benchmarking
      a >= 224 // multicast and reserved
    );
  }

  if (!value.includes(":")) return true; // not an address this code understands
  if (value === "::" || value === "::1") return true;
  return /^(f[cd]|fe[89ab]|ff)/.test(value); // unique local, link local, multicast
};
