import { describe, it, expect } from "vitest";
import { tools } from "../src/tools.js";

describe("tools", () => {
  it("should have 4 tools defined", () => {
    expect(tools).toHaveLength(4);
  });

  it("should have unique tool names", () => {
    const names = tools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  describe("create_partner_profile", () => {
    const tool = tools.find((t) => t.name === "create_partner_profile")!;

    it("should create a profile with brand and contact", async () => {
      const result = await tool.execute({ brand: "Red Bull", contact: "redbull@test.com" });
      expect(result.profileId).toMatch(/^prof_/);
      expect(result.brand).toBe("Red Bull");
      expect(result.contact).toBe("redbull@test.com");
      expect(result.status).toBe("active");
    });

    it("should compensate by deleting the profile", async () => {
      const result = await tool.compensate!({ profileId: "prof_123" });
      expect(result.deleted).toBe(true);
    });
  });

  describe("send_agreement", () => {
    const tool = tools.find((t) => t.name === "send_agreement")!;

    it("should send an agreement successfully", async () => {
      const result = await tool.execute({
        profileId: "prof_123",
        terms: "3 posts, 15000€",
        contact: "partner@test.com",
      });
      expect(result.agreementId).toMatch(/^agr_/);
      expect(result.terms).toBe("3 posts, 15000€");
      expect(result.status).toBe("sent");
    });

    it("should fail when contact contains 'fail'", async () => {
      await expect(
        tool.execute({
          profileId: "prof_123",
          terms: "standard",
          contact: "fail@test.com",
        })
      ).rejects.toThrow("Adresse invalide");
    });

    it("should compensate by voiding the agreement", async () => {
      const result = await tool.compensate!({ agreementId: "agr_123" });
      expect(result.status).toBe("voided");
    });
  });

  describe("setup_tracking", () => {
    const tool = tools.find((t) => t.name === "setup_tracking")!;

    it("should setup tracking for given platforms", async () => {
      const result = await tool.execute({
        profileId: "prof_123",
        platforms: "youtube, instagram",
      });
      expect(result.trackingId).toMatch(/^trk_/);
      expect(result.platforms).toBe("youtube, instagram");
      expect(result.status).toBe("active");
    });

    it("should compensate by disabling tracking", async () => {
      const result = await tool.compensate!({ trackingId: "trk_123" });
      expect(result.status).toBe("disabled");
    });
  });

  describe("notify_team", () => {
    const tool = tools.find((t) => t.name === "notify_team")!;

    it("should notify the team", async () => {
      const result = await tool.execute({
        profileId: "prof_123",
        channel: "slack",
      });
      expect(result.channel).toBe("slack");
      expect(result.status).toBe("notified");
    });

    it("should compensate by skipping", async () => {
      const result = await tool.compensate!();
      expect(result.status).toBe("skipped");
    });
  });
});