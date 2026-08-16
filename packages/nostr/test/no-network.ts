const LOCAL = /^wss?:\/\/(127\.0\.0\.1|\[::1\]|localhost)([:/]|$)/i;

/**
 * Tests talk to mock relays on the loopback, never to a public one: a suite
 * whose result depends on what a relay serves today is not a test. Reaching
 * outside fails here instead of failing intermittently in CI.
 */
globalThis.WebSocket = new Proxy(globalThis.WebSocket, {
  construct(target, args: [string]) {
    if (!LOCAL.test(String(args[0]))) {
      throw new Error(`a test tried to reach ${args[0]}, use a mock relay instead`);
    }
    return new target(...args);
  },
});
