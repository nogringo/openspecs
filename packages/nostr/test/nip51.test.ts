import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";
import { createMockRelay, type MockRelay } from "nostr-mock-relay";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type NostrEvent, SPEC_KIND } from "../src/event";
import { editMuteList, fetchMuteList, MUTE_LIST_KIND, parseMuteList } from "../src/nip51";

const secret = generateSecretKey();
const me = getPublicKey(secret);

const alice = "1".repeat(64);
const bob = "2".repeat(64);
const NOTE = "e".repeat(64);
const COORDINATE = `${SPEC_KIND}:${alice}:custom-xyz`;

const list = (tags: string[][], options: { content?: string; at?: number } = {}) =>
  finalizeEvent(
    {
      kind: MUTE_LIST_KIND,
      content: options.content ?? "",
      tags,
      created_at: options.at ?? 1_700_000_000,
    },
    secret,
  ) as NostrEvent;

describe("parseMuteList", () => {
  it("reads the keys, the notes and the documents, and ignores the rest", () => {
    const parsed = parseMuteList(
      list([
        ["p", alice],
        ["e", NOTE],
        ["a", COORDINATE],
        ["t", "politics"],
        ["word", "spoiler"],
        ["a", `30023:${bob}:an-article`],
        ["p", "not a key"],
        ["e", NOTE.slice(1)],
      ]),
    );

    expect(parsed).toMatchObject({
      pubkeys: [alice],
      eventIds: [NOTE],
      coordinates: [COORDINATE],
      hasPrivate: false,
      updatedAt: 1_700_000_000,
    });
  });

  it("says when the list holds private items it cannot open", () => {
    expect(parseMuteList(list([], { content: "AbCd==" }))?.hasPrivate).toBe(true);
  });

  it("names each thing once, however many times the list repeats it", () => {
    expect(
      parseMuteList(
        list([
          ["p", alice],
          ["p", alice],
        ]),
      )?.pubkeys,
    ).toEqual([alice]);
  });

  it("refuses another kind", () => {
    expect(parseMuteList({ ...list([["p", alice]]), kind: 10001 })).toBeNull();
  });
});

describe("editMuteList", () => {
  const live = list(
    [
      ["p", alice],
      ["t", "politics"],
      ["word", "spoiler"],
      ["client", "Somebody Else"],
      ["e", NOTE],
    ],
    { content: "AbCd==" },
  );

  it("keeps the content byte for byte, since only the owner's key can read it", () => {
    expect(editMuteList(live, { add: [{ type: "p", value: bob }] }).content).toBe("AbCd==");
  });

  it("keeps every tag it does not read, in the order they came, and names itself last", () => {
    expect(editMuteList(live, { add: [{ type: "a", value: COORDINATE }] }).tags).toEqual([
      ["p", alice],
      ["t", "politics"],
      ["word", "spoiler"],
      ["e", NOTE],
      ["a", COORDINATE],
      ["client", "Open Specs"],
    ]);
  });

  it("adds a thing once", () => {
    const tags = editMuteList(live, { add: [{ type: "p", value: alice }] }).tags;
    expect(tags.filter((tag) => tag[0] === "p")).toEqual([["p", alice]]);
  });

  it("removes only the tag named", () => {
    const tags = editMuteList(live, { remove: [{ type: "p", value: alice }] }).tags;
    expect(tags).toEqual([
      ["t", "politics"],
      ["word", "spoiler"],
      ["e", NOTE],
      ["client", "Open Specs"],
    ]);
  });

  it("starts a fresh list for a key that never published one", () => {
    expect(editMuteList(null, { add: [{ type: "p", value: bob }] })).toEqual({
      kind: MUTE_LIST_KIND,
      content: "",
      tags: [
        ["p", bob],
        ["client", "Open Specs"],
      ],
    });
  });

  it("takes nothing from an event of another kind handed to it by mistake", () => {
    const wrong = { ...live, kind: 3 };
    expect(editMuteList(wrong, {})).toEqual({
      kind: MUTE_LIST_KIND,
      content: "",
      tags: [["client", "Open Specs"]],
    });
  });
});

/**
 * A server that completes the WebSocket handshake and then says nothing at
 * all: a relay that is up, takes the REQ, and never sends an EOSE.
 */
const silentRelay = (): Promise<{ url: string; stop: () => Promise<void> }> =>
  new Promise((resolve) => {
    const server: Server = createServer();
    const sockets = new Set<Duplex>();
    server.on("upgrade", (request, socket) => {
      const key = String(request.headers["sec-websocket-key"]);
      const accept = createHash("sha1")
        .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
        .digest("base64");
      socket.write(
        [
          "HTTP/1.1 101 Switching Protocols",
          "Upgrade: websocket",
          "Connection: Upgrade",
          `Sec-WebSocket-Accept: ${accept}`,
          "",
          "",
        ].join("\r\n"),
      );
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
    });
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `ws://127.0.0.1:${port}/`,
        stop: () =>
          new Promise((done) => {
            for (const socket of sockets) socket.destroy();
            server.close(() => done());
          }),
      });
    });
  });

describe("fetchMuteList", () => {
  let relay: MockRelay;
  let silent: Awaited<ReturnType<typeof silentRelay>>;

  beforeAll(async () => {
    relay = createMockRelay();
    await relay.start();
    relay.seed([
      list([["p", alice]], { at: 1_700_000_000 }),
      list([["p", bob]], { at: 1_700_000_100 }),
    ]);
    silent = await silentRelay();
  });

  afterAll(async () => {
    await relay.stop();
    await silent.stop();
  });

  it("returns the newest revision and names the relay that finished", async () => {
    const read = await fetchMuteList(me, { relays: [relay.url ?? ""] });

    expect(parseMuteList(read.event)?.pubkeys).toEqual([bob]);
    expect(read.answered).toEqual([relay.url]);
  });

  it("names a relay that answered with nothing, which is an answer", async () => {
    const stranger = getPublicKey(generateSecretKey());
    const read = await fetchMuteList(stranger, { relays: [relay.url ?? ""] });

    expect(read.event).toBeNull();
    expect(read.answered).toEqual([relay.url]);
  });

  it("does not name a relay it could not reach, and still comes back", async () => {
    const read = await fetchMuteList(me, { relays: ["ws://127.0.0.1:1/"], timeoutMs: 1000 });

    expect(read.event).toBeNull();
    expect(read.answered).toEqual([]);
  });

  it("gives up on a relay that took the question and never finished, without counting it", async () => {
    const started = Date.now();
    const read = await fetchMuteList(me, {
      relays: [silent.url, relay.url ?? ""],
      timeoutMs: 500,
    });

    expect(Date.now() - started).toBeGreaterThanOrEqual(450);
    expect(read.answered).toEqual([relay.url]);
    expect(parseMuteList(read.event)?.pubkeys).toEqual([bob]);
  });

  it("asks nobody when given no relays", async () => {
    expect(await fetchMuteList(me, { relays: [] })).toEqual({ event: null, answered: [] });
  });
});
