import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** A fake with the one behaviour that matters: it can be written to and read back. */
const fakeStorage = (broken = false): Storage => {
  const held = new Map<string, string>();
  return {
    getItem: (key: string) => {
      if (broken) throw new Error("this browser is in a private window");
      return held.get(key) ?? null;
    },
    setItem: (key: string, value: string) => {
      if (broken) throw new Error("this browser is in a private window");
      held.set(key, value);
    },
    removeItem: (key: string) => {
      if (broken) throw new Error("this browser is in a private window");
      held.delete(key);
    },
    clear: () => held.clear(),
    key: () => null,
    length: 0,
  } as unknown as Storage;
};

/** Read once and kept, so every case needs the module as it is on a fresh page. */
const load = async () => {
  vi.resetModules();
  return await import("./alerts");
};

type Knock = { title: string; body: string; tag?: string };

let knocks: Knock[];

/** Standing in for the browser's own, which vitest runs without. */
const fakeNotification = (permission: NotificationPermission, granting = permission) => {
  const fake = function (this: Record<string, unknown>, title: string, options: Knock) {
    knocks.push({ title, body: options.body, tag: options.tag });
    this.close = () => {};
  } as unknown as typeof Notification;
  Object.defineProperty(fake, "permission", { value: permission, configurable: true });
  Object.defineProperty(fake, "requestPermission", {
    value: async () => granting,
    configurable: true,
  });
  return fake;
};

beforeEach(() => {
  knocks = [];
  vi.stubGlobal("localStorage", fakeStorage());
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the setting", () => {
  it("is off for a browser that has never been asked", async () => {
    const { alertsWanted } = await load();
    expect(alertsWanted()).toBe(false);
  });

  it("is on again on the next page load, once it has been turned on", async () => {
    const first = await load();
    first.setAlertsWanted(true);
    expect((await load()).alertsWanted()).toBe(true);
  });

  it("forgets it rather than storing a no", async () => {
    const { alertsWanted, setAlertsWanted } = await load();
    setAlertsWanted(true);
    setAlertsWanted(false);
    expect(alertsWanted()).toBe(false);
    expect(localStorage.getItem("openspecs:alerts")).toBeNull();
  });

  it("stays off, rather than throwing, where storage is refused", async () => {
    vi.stubGlobal("localStorage", fakeStorage(true));
    const { alertsWanted, setAlertsWanted } = await load();
    expect(() => setAlertsWanted(true)).not.toThrow();
    expect(alertsWanted()).toBe(true);
  });

  it("is off on a server, which knocks on nobody's door", async () => {
    expect((await load()).serverAlertsWanted()).toBe(false);
  });

  it("tells a subscriber that it changed", async () => {
    const { setAlertsWanted, subscribeAlerts } = await load();
    const listener = vi.fn();
    const stop = subscribeAlerts(listener);
    setAlertsWanted(true);
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
    setAlertsWanted(false);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("the permission", () => {
  it("reads a browser with no such thing as unsupported, which is not a refusal", async () => {
    vi.stubGlobal("Notification", undefined);
    const { alertPermission, askToAlert } = await load();
    expect(alertPermission()).toBe("unsupported");
    expect(await askToAlert()).toBe("unsupported");
  });

  it("asks a browser that has not been asked", async () => {
    vi.stubGlobal("Notification", fakeNotification("default", "granted"));
    expect(await (await load()).askToAlert()).toBe("granted");
  });

  it("never asks one that already refused, since it would not show the prompt", async () => {
    const notification = fakeNotification("denied", "granted");
    const asked = vi.spyOn(notification, "requestPermission");
    vi.stubGlobal("Notification", notification);

    expect(await (await load()).askToAlert()).toBe("denied");
    expect(asked).not.toHaveBeenCalled();
  });
});

describe("knocking", () => {
  const alert = (body: string) => ({ body, path: "/spec/npub1/nip-07" });

  beforeEach(() => {
    vi.stubGlobal("Notification", fakeNotification("granted"));
    vi.stubGlobal("window", { focus: () => {}, location: { assign: () => {} } });
  });

  it("knocks straight away the first time", async () => {
    const { showAlert } = await load();
    showAlert(alert("alice commented on nip-07"));
    expect(knocks.map((k) => k.body)).toEqual(["alice commented on nip-07"]);
  });

  it("holds the rest of the window and says how many, rather than knocking five times", async () => {
    const { showAlert, ALERT_GAP_MS } = await load();
    showAlert(alert("one"));
    for (const body of ["two", "three", "four"]) showAlert(alert(body));
    expect(knocks).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(ALERT_GAP_MS);
    expect(knocks.map((k) => k.body)).toEqual(["one", "3 new notifications"]);
  });

  it("says the one thing that happened when only one did", async () => {
    const { showAlert, ALERT_GAP_MS } = await load();
    showAlert(alert("one"));
    showAlert(alert("two"));
    await vi.advanceTimersByTimeAsync(ALERT_GAP_MS);
    expect(knocks.map((k) => k.body)).toEqual(["one", "two"]);
  });

  it("knocks again once the window has passed with nothing in it", async () => {
    const { showAlert, ALERT_GAP_MS } = await load();
    showAlert(alert("one"));
    await vi.advanceTimersByTimeAsync(ALERT_GAP_MS);
    showAlert(alert("two"));
    expect(knocks).toHaveLength(2);
  });

  it("replaces the last in the tray rather than stacking beside it", async () => {
    const { showAlert } = await load();
    showAlert(alert("one"));
    expect(knocks[0]?.tag).toBe("openspecs");
    expect(knocks[0]?.title).toBe("Open Specs");
  });

  it("forgets what it was holding when asked", async () => {
    const { showAlert, clearAlerts, ALERT_GAP_MS } = await load();
    showAlert(alert("one"));
    showAlert(alert("two"));
    clearAlerts();
    await vi.advanceTimersByTimeAsync(ALERT_GAP_MS);
    expect(knocks).toHaveLength(1);
  });
});
