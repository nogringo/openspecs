import { describe, expect, it } from "vitest";
import { toResult } from "./rebroadcast";

const RELAY = "wss://a.example";

describe("toResult", () => {
  it("reports an acceptance, worded even when the relay says nothing", () => {
    expect(toResult(RELAY, { status: "fulfilled", value: "" })).toEqual({
      relay: RELAY,
      accepted: true,
      message: "accepted",
    });
  });

  it("reports a refusal in the relay's own words", () => {
    expect(
      toResult(RELAY, { status: "rejected", reason: new Error("blocked: pubkey not admitted") }),
    ).toEqual({
      relay: RELAY,
      accepted: false,
      message: "blocked: pubkey not admitted",
    });
  });

  it("gives words to a relay that refuses without saying why", () => {
    for (const reason of [new Error(""), undefined, ""]) {
      expect(toResult(RELAY, { status: "rejected", reason }).message).toBe("refused");
    }
  });

  it("keeps what a relay says when it accepts with a comment", () => {
    expect(
      toResult(RELAY, { status: "fulfilled", value: "duplicate: already have this event" }),
    ).toMatchObject({ accepted: true, message: "duplicate: already have this event" });
  });
});
