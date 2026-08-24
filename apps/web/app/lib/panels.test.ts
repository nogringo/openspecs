import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  closePanel,
  closePanels,
  openPanel,
  panelState,
  serverPanelState,
  subscribePanels,
  togglePanel,
} from "./panels";

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

/** A click that landed on something, which either sits inside a panel or does not. */
const on = (inside: boolean) => ({ target: { closest: () => (inside ? {} : null) } });

beforeEach(() => vi.stubGlobal("document", fakeDocument()));

afterEach(() => {
  closePanels();
  vi.unstubAllGlobals();
});

describe("panelState", () => {
  it("starts closed, and the server never opens one", () => {
    expect(panelState()).toBeNull();
    expect(serverPanelState()).toBeNull();
  });

  it("holds one at a time, so opening the second puts the first away", () => {
    openPanel("notifications");
    expect(panelState()).toBe("notifications");
    openPanel("identity");
    expect(panelState()).toBe("identity");
  });

  it("shuts the one already open when its own control is pressed again", () => {
    togglePanel("identity");
    expect(panelState()).toBe("identity");
    togglePanel("identity");
    expect(panelState()).toBeNull();
  });

  it("tells whoever is watching, and stops once they leave", () => {
    let told = 0;
    const stop = subscribePanels(() => {
      told += 1;
    });
    openPanel("identity");
    expect(told).toBe(1);
    // Opening what is already open changes nothing, so it says nothing.
    openPanel("identity");
    expect(told).toBe(1);
    stop();
    closePanels();
    expect(told).toBe(1);
  });
});

describe("closePanel", () => {
  it("closes the one named", () => {
    openPanel("identity");
    closePanel("identity");
    expect(panelState()).toBeNull();
  });

  it("leaves the other one alone, since it is not the one going away", () => {
    openPanel("identity");
    closePanel("notifications");
    expect(panelState()).toBe("identity");
  });
});

describe("the ways out", () => {
  it("closes on a click that lands outside every panel", () => {
    openPanel("notifications");
    fire("pointerdown", on(false));
    expect(panelState()).toBeNull();
  });

  it("stays open for a click that lands inside one", () => {
    openPanel("notifications");
    fire("pointerdown", on(true));
    expect(panelState()).toBe("notifications");
  });

  it("closes on Escape and on nothing else pressed", () => {
    openPanel("identity");
    fire("keydown", { key: "a" });
    expect(panelState()).toBe("identity");
    fire("keydown", { key: "Escape" });
    expect(panelState()).toBeNull();
  });

  it("watches the page only while something is open", () => {
    expect(listening()).toBe(0);
    openPanel("identity");
    expect(listening()).toBe(2);
    // Swapping one panel for the other is not a reason to let go and take hold.
    openPanel("notifications");
    expect(listening()).toBe(2);
    closePanels();
    expect(listening()).toBe(0);
  });
});
