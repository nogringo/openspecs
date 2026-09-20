import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listenForDismissal } from "./dismiss";

type Listener = (event: Event) => void;

let held: Map<string, Set<Listener>>;

const fakeDocument = () => {
  held = new Map();
  return {
    addEventListener: (type: string, listener: Listener) => {
      const set = held.get(type) ?? new Set<Listener>();
      set.add(listener);
      held.set(type, set);
    },
    removeEventListener: (type: string, listener: Listener) => {
      held.get(type)?.delete(listener);
    },
  } as unknown as Document;
};

const listening = (): number => [...held.values()].reduce((count, set) => count + set.size, 0);

const fire = (type: string, event: unknown): void => {
  for (const listener of held.get(type) ?? []) listener(event as Event);
};

beforeEach(() => vi.stubGlobal("document", fakeDocument()));
afterEach(() => vi.unstubAllGlobals());

describe("listenForDismissal", () => {
  it("closes on a pointer that landed outside, and not on one that landed inside", () => {
    const inside = {} as EventTarget;
    let closed = 0;
    listenForDismissal(
      (target) => target === inside,
      () => {
        closed += 1;
      },
    );

    fire("pointerdown", { target: inside });
    expect(closed).toBe(0);
    fire("pointerdown", { target: { elsewhere: true } });
    expect(closed).toBe(1);
  });

  it("closes on Escape and on nothing else pressed", () => {
    let closed = 0;
    listenForDismissal(
      () => false,
      () => {
        closed += 1;
      },
    );

    fire("keydown", { key: "a" });
    expect(closed).toBe(0);
    fire("keydown", { key: "Escape" });
    expect(closed).toBe(1);
  });

  it("lets go of the page when told to, so a closed panel costs nothing", () => {
    const stop = listenForDismissal(
      () => false,
      () => {},
    );
    expect(listening()).toBe(2);
    stop();
    expect(listening()).toBe(0);
  });

  it("listens to nothing where there is no document, which is every render on the server", () => {
    vi.stubGlobal("document", undefined);
    expect(() =>
      listenForDismissal(
        () => false,
        () => {},
      )(),
    ).not.toThrow();
  });
});
