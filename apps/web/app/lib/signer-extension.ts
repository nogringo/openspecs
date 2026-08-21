// `nostr-tools/nip07` maps to types alone in the package's exports, with no
// `import` condition: taken as a value it type checks and then fails to resolve
// in the browser. It is a shape an extension provides, never code this ships.
import type { WindowNostr } from "nostr-tools/nip07";
import type { AppSigner } from "./signer";

declare global {
  interface Window {
    nostr?: WindowNostr;
  }
}

/** Long enough for the extensions that inject late, short enough to answer a click. */
export const EXTENSION_WAIT_MS = 3000;
const POLL_MS = 100;

/**
 * Extensions inject `window.nostr` at different moments, some of them after this
 * page has hydrated, and there is no event to wait for. A reader can also
 * install one while this tab sits open, which is what the visibility check is
 * for: coming back to the tab is when they would expect it to have noticed.
 */
export const waitForExtension = (timeoutMs = EXTENSION_WAIT_MS): Promise<WindowNostr | null> => {
  if (typeof window === "undefined") return Promise.resolve(null);
  if (window.nostr !== undefined) return Promise.resolve(window.nostr);

  return new Promise((resolve) => {
    const stop = (found: WindowNostr | null) => {
      clearInterval(polling);
      clearTimeout(deadline);
      window.removeEventListener("visibilitychange", look);
      window.removeEventListener("focus", look);
      resolve(found);
    };

    const look = () => {
      if (window.nostr !== undefined) stop(window.nostr);
    };

    const polling = setInterval(look, POLL_MS);
    const deadline = setTimeout(() => stop(null), timeoutMs);
    window.addEventListener("visibilitychange", look);
    window.addEventListener("focus", look);
  });
};

/**
 * Never asks the extension who it is. Several of them prompt on that call, and
 * an app that prompts as its page loads is one whose prompts get dismissed
 * without reading. The key is taken from the session, and a disagreement is
 * caught after the first signature instead.
 */
export const extensionSigner = async (timeoutMs?: number): Promise<AppSigner> => {
  const nostr = await waitForExtension(timeoutMs);
  if (nostr === null) throw new Error("no signing extension answered");

  return {
    getPublicKey: () => nostr.getPublicKey(),
    signEvent: (draft) => nostr.signEvent(draft),
  };
};
