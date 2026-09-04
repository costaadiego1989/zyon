import { describe, expect, it } from "vitest";
import {
  createTranscriptManager,
  type TranscriptMessage,
} from "../../lib/voice/transcript-manager.js";

describe("transcript-manager", () => {
  it("starts with an empty transcript", () => {
    const tm = createTranscriptManager();
    expect(tm.getMessages()).toEqual([]);
    expect(tm.size()).toBe(0);
  });

  it("appends a buyer message and returns its id", () => {
    const tm = createTranscriptManager();
    const id = tm.add({ role: "buyer", text: "oi" });

    expect(id).toBeTypeOf("string");
    expect(tm.size()).toBe(1);
    expect(tm.getMessages()[0]).toMatchObject({ role: "buyer", text: "oi", id });
  });

  it("appends an agent message", () => {
    const tm = createTranscriptManager();
    tm.add({ role: "agent", text: "olá, como posso ajudar?" });

    expect(tm.size()).toBe(1);
    expect(tm.getMessages()[0]).toMatchObject({ role: "agent" });
  });

  it("stamps each message with a monotonic timestamp", () => {
    const tm = createTranscriptManager();
    const first = tm.add({ role: "buyer", text: "a" });
    const second = tm.add({ role: "agent", text: "b" });

    expect(tm.getMessages()[0]!.timestamp).toBeLessThanOrEqual(tm.getMessages()[1]!.timestamp);
    expect(first).not.toBe(second);
  });

  it("returns the last message of a given role", () => {
    const tm = createTranscriptManager();
    tm.add({ role: "buyer", text: "first" });
    tm.add({ role: "agent", text: "hi" });
    tm.add({ role: "buyer", text: "second" });

    expect(tm.getLastByRole("buyer")?.text).toBe("second");
    expect(tm.getLastByRole("agent")?.text).toBe("hi");
  });

  it("returns null for lastByRole when no messages of that role exist", () => {
    const tm = createTranscriptManager();
    tm.add({ role: "agent", text: "hi" });
    expect(tm.getLastByRole("buyer")).toBeNull();
  });

  it("limits the in-memory transcript to maxSize messages (FIFO eviction)", () => {
    const tm = createTranscriptManager({ maxSize: 3 });
    tm.add({ role: "buyer", text: "1" });
    tm.add({ role: "agent", text: "2" });
    tm.add({ role: "buyer", text: "3" });
    tm.add({ role: "agent", text: "4" });

    const msgs = tm.getMessages();
    expect(msgs).toHaveLength(3);
    expect(msgs.map((m: TranscriptMessage) => m.text)).toEqual(["2", "3", "4"]);
  });

  it("clears the transcript", () => {
    const tm = createTranscriptManager();
    tm.add({ role: "buyer", text: "x" });
    tm.add({ role: "agent", text: "y" });
    tm.clear();

    expect(tm.getMessages()).toEqual([]);
    expect(tm.size()).toBe(0);
  });

  it("tracks turn-taking: alternates between buyer and agent", () => {
    const tm = createTranscriptManager();
    tm.add({ role: "buyer", text: "1" });
    tm.add({ role: "agent", text: "2" });
    tm.add({ role: "buyer", text: "3" });

    const turns = tm.getTurns();
    expect(turns).toHaveLength(3);
    expect(turns[0]?.role).toBe("buyer");
    expect(turns[1]?.role).toBe("agent");
    expect(turns[2]?.role).toBe("buyer");
  });

  it("supports session continuity by exporting + importing a snapshot", () => {
    const tm1 = createTranscriptManager();
    tm1.add({ role: "buyer", text: "oi" });
    tm1.add({ role: "agent", text: "olá" });

    const snapshot = tm1.export();
    const tm2 = createTranscriptManager();
    tm2.import(snapshot);

    expect(tm2.getMessages()).toEqual(tm1.getMessages());
  });

  it("subscribes to transcript changes", () => {
    const tm = createTranscriptManager();
    const seen: string[] = [];
    const unsub = tm.subscribe((msg) => {
      seen.push(msg.text);
    });

    tm.add({ role: "buyer", text: "a" });
    tm.add({ role: "agent", text: "b" });
    unsub();

    tm.add({ role: "buyer", text: "c" });
    expect(seen).toEqual(["a", "b"]);
  });
});