import { describe, expect, it } from "vitest";
import { topicsByFrequency } from "./topics";

const documents = (...topics: string[][]) => topics.map((list) => ({ topics: list }));

describe("topicsByFrequency", () => {
  it("puts the most used topic first", () => {
    const specs = documents(["relays", "nips"], ["relays"], ["nips", "relays"], ["keys"]);
    expect(topicsByFrequency(specs, 10)).toEqual(["relays", "nips", "keys"]);
  });

  it("breaks a tie alphabetically, so the row keeps its order", () => {
    expect(topicsByFrequency(documents(["zap"], ["blossom"]), 10)).toEqual(["blossom", "zap"]);
  });

  it("keeps only the first few", () => {
    expect(topicsByFrequency(documents(["a"], ["b"], ["c"]), 2)).toHaveLength(2);
  });

  it("returns nothing when no document carries a topic", () => {
    expect(topicsByFrequency(documents([], []), 10)).toEqual([]);
  });
});
