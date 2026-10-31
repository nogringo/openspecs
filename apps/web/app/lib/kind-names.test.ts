import { describe, expect, it } from "vitest";
import { kindNamed, kindNames } from "./kind-names";

const documents = (...kinds: [string, string | null][][]) =>
  kinds.map((list) => ({ kinds: list.map(([raw, name]) => ({ raw, name })) }));

describe("kindNames", () => {
  it("names a kind the way most documents name it", () => {
    const specs = documents(
      [["1059", "Gift Wrap"]],
      [["1059", "Gift wrap"]],
      [["1059", "Gift Wrap"]],
    );
    expect(kindNames(specs).get("1059")).toBe("Gift Wrap");
  });

  it("breaks a tie alphabetically, so the name does not flip between two", () => {
    const specs = documents([["13", "Seal"]], [["13", "Sealed rumor"]]);
    expect(kindNames(specs).get("13")).toBe("Seal");
  });

  it("knows nothing of a kind no document names", () => {
    expect(kindNames(documents([["7", null]])).has("7")).toBe(false);
  });

  it("keeps a value that is not a number", () => {
    expect(kindNames(documents([["nip-90", "Data vending"]])).get("nip-90")).toBe("Data vending");
  });
});

describe("kindNamed", () => {
  const names = new Map([
    ["9734", "Zap Request"],
    ["9735", "Zap"],
    ["10002", "Relay List"],
    ["10050", "Relay List"],
  ]);

  it("finds the kind a name belongs to", () => {
    expect(kindNamed(names, "Zap")).toBe("9735");
  });

  it("finds nothing for a name no kind carries", () => {
    expect(kindNamed(names, "Zap request")).toBeNull();
  });

  it("refuses to choose between two kinds with the same name", () => {
    expect(kindNamed(names, "Relay List")).toBeNull();
  });
});
