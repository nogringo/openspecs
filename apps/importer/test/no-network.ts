const LOCAL = /^wss?:\/\/(127\.0\.0\.1|\[::1\]|localhost)([:/]|$)/i;

/**
 * Tests talk to mock relays on the loopback, never to a public one: a suite
 * that publishes to a relay somebody reads is not a test.
 */
globalThis.WebSocket = new Proxy(globalThis.WebSocket, {
  construct(target, args: [string]) {
    if (!LOCAL.test(String(args[0]))) {
      throw new Error(`a test tried to reach ${args[0]}, use a mock relay instead`);
    }
    return new target(...args);
  },
});
