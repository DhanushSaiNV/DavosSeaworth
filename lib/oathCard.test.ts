// lib/oathCard.test.ts
import {
  isOathRequest,
  isOathConsumed,
  parseOathCard,
  oathCardsForRows,
  getActiveOathRequestId,
} from "./oathCard";

describe("oathCard", () => {
  describe("isOathRequest", () => {
    it("returns false for null / primitive metadata", () => {
      expect(isOathRequest(null)).toBe(false);
      expect(isOathRequest(undefined)).toBe(false);
      expect(isOathRequest("not-an-object")).toBe(false);
      expect(isOathRequest([])).toBe(false);
    });

    it("returns false for normal assistant metadata", () => {
      expect(isOathRequest({})).toBe(false);
      expect(isOathRequest({ source: "checkin" })).toBe(false);
      expect(isOathRequest({ persona: "mentor_tough" })).toBe(false);
    });

    it("returns true when source is oath_request or oath_request is true", () => {
      expect(isOathRequest({ source: "oath_request" })).toBe(true);
      expect(isOathRequest({ oath_request: true })).toBe(true);
      expect(isOathRequest({ source: "oath_request", oath_request: true })).toBe(true);
    });
  });

  describe("isOathConsumed", () => {
    it("returns false when consumed is missing or false", () => {
      expect(isOathConsumed(null)).toBe(false);
      expect(isOathConsumed({})).toBe(false);
      expect(isOathConsumed({ consumed: false })).toBe(false);
    });

    it("returns true when consumed is true", () => {
      expect(isOathConsumed({ consumed: true })).toBe(true);
    });
  });

  describe("parseOathCard", () => {
    it("returns null for non-oath metadata", () => {
      expect(parseOathCard(null)).toBeNull();
      expect(parseOathCard({ source: "general" })).toBeNull();
    });

    it("returns demanded state when unconsumed", () => {
      const card = parseOathCard({
        source: "oath_request",
        oath_request: true,
      });
      expect(card).toEqual({
        state: "demanded",
        consumedAt: undefined,
        consumedMessageId: undefined,
      });
    });

    it("returns sealed state when consumed", () => {
      const card = parseOathCard({
        source: "oath_request",
        oath_request: true,
        consumed: true,
        consumed_at: "2026-10-29T11:00:00Z",
        consumed_message_id: "msg-123",
      });
      expect(card).toEqual({
        state: "sealed",
        consumedAt: "2026-10-29T11:00:00Z",
        consumedMessageId: "msg-123",
      });
    });
  });

  describe("oathCardsForRows", () => {
    it("indexes assistant oath requests by message id", () => {
      const rows = [
        { id: "u-1", role: "user", content: "hello" },
        { id: "a-1", role: "assistant", metadata: { source: "oath_request" } },
        { id: "u-2", role: "user", content: "ok" },
        { id: "a-2", role: "assistant", metadata: { source: "checkin" } },
        { id: "a-3", role: "assistant", metadata: { source: "oath_request", consumed: true } },
      ];
      const map = oathCardsForRows(rows);
      expect(map.size).toBe(2);
      expect(map.get("a-1")?.state).toBe("demanded");
      expect(map.get("a-3")?.state).toBe("sealed");
      expect(map.has("u-1")).toBe(false);
      expect(map.has("a-2")).toBe(false);
    });
  });

  describe("getActiveOathRequestId", () => {
    it("returns null for empty rows or user tail", () => {
      expect(getActiveOathRequestId([])).toBeNull();
      expect(getActiveOathRequestId([{ id: "u-1", role: "user" }])).toBeNull();
    });

    it("returns null when tail is assistant but not oath request", () => {
      const rows = [
        { id: "a-1", role: "assistant", metadata: { source: "checkin" } },
      ];
      expect(getActiveOathRequestId(rows)).toBeNull();
    });

    it("returns null when tail is an already-consumed oath request", () => {
      const rows = [
        { id: "a-1", role: "assistant", metadata: { source: "oath_request", consumed: true } },
      ];
      expect(getActiveOathRequestId(rows)).toBeNull();
    });

    it("returns id when tail is an active unconsumed oath request", () => {
      const rows = [
        { id: "u-1", role: "user" },
        { id: "a-1", role: "assistant", metadata: { source: "oath_request", oath_request: true } },
      ];
      expect(getActiveOathRequestId(rows)).toBe("a-1");
    });
  });
});
