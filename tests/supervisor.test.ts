import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock LLM SDKs before importing Supervisor
const mockGeminiGenerate = vi.fn();

class MockGeminiModel {
  generateContent = mockGeminiGenerate;
}

let MockGoogleGenerativeAI: any;
vi.mock("@google/generative-ai", () => {
  class GeminiAI {
    getGenerativeModel() {
      return new MockGeminiModel();
    }
  }
  return { GoogleGenerativeAI: GeminiAI };
});

const mockDeepseekCreate = vi.fn();
vi.mock("openai", () => {
  class MockOpenAI {
    chat = { completions: { create: mockDeepseekCreate } };
  }
  return { default: MockOpenAI };
});

vi.mock("../src/config.js", () => ({
  config: {
    geminiApiKey: "test-gemini-key",
    deepseekApiKey: "test-deepseek-key",
    primaryProvider: "gemini",
    geminiModel: "gemini-2.5-flash",
    deepseekModel: "deepseek-chat",
  },
}));

// Mock EventStore (needed by Supervisor constructor)
const mockEventStore = {
  getWorkflow: vi.fn(),
  createWorkflow: vi.fn(),
  updateStatus: vi.fn(),
  savePlan: vi.fn(),
  appendExecutionLog: vi.fn(),
  appendCompensationLog: vi.fn(),
  getCallbackUrl: vi.fn(),
};
vi.mock("../src/event-store.js", () => ({
  EventStore: class MockEventStore {
    constructor() {
      return mockEventStore;
    }
  },
}));

import { config } from "../src/config.js";
import { SupervisorAgent } from "../src/supervisor.js";

describe("SupervisorAgent", () => {
  let supervisor: SupervisorAgent;

  beforeEach(() => {
    vi.clearAllMocks();
    (config as any).primaryProvider = "gemini";
    supervisor = new SupervisorAgent(mockEventStore as any);
  });

  describe("callLLM — fallback", () => {
    it("should use Gemini (primary) first", async () => {
      mockGeminiGenerate.mockResolvedValueOnce({
        response: { text: () => '{"analysis":"test","steps":[]}' },
      });
      const result = await (supervisor as any).callLLM("test prompt");
      expect(result).toBe('{"analysis":"test","steps":[]}');
      expect(mockGeminiGenerate).toHaveBeenCalledTimes(1);
      expect(mockDeepseekCreate).not.toHaveBeenCalled();
    });

    it("should fallback to DeepSeek when Gemini fails", async () => {
      mockGeminiGenerate.mockRejectedValueOnce(new Error("Gemini timeout"));
      mockDeepseekCreate.mockResolvedValueOnce({
        choices: [{ message: { content: '{"analysis":"fallback","steps":[]}' } }],
      });
      const result = await (supervisor as any).callLLM("test prompt");
      expect(result).toBe('{"analysis":"fallback","steps":[]}');
      expect(mockGeminiGenerate).toHaveBeenCalledTimes(1);
      expect(mockDeepseekCreate).toHaveBeenCalledTimes(1);
    });

    it("should throw when both providers fail", async () => {
      mockGeminiGenerate.mockRejectedValueOnce(new Error("Gemini down"));
      mockDeepseekCreate.mockRejectedValueOnce(new Error("DeepSeek down"));
      await expect((supervisor as any).callLLM("test")).rejects.toThrow("DeepSeek down");
      expect(mockGeminiGenerate).toHaveBeenCalledTimes(1);
      expect(mockDeepseekCreate).toHaveBeenCalledTimes(1);
    });

    it("should try DeepSeek first when primaryProvider = deepseek", async () => {
      (config as any).primaryProvider = "deepseek";
      mockDeepseekCreate.mockResolvedValueOnce({
        choices: [{ message: { content: '{"analysis":"ok","steps":[]}' } }],
      });
      const result = await (supervisor as any).callLLM("test");
      expect(result).toBe('{"analysis":"ok","steps":[]}');
      expect(mockDeepseekCreate).toHaveBeenCalledTimes(1);
      expect(mockGeminiGenerate).not.toHaveBeenCalled();
    });
  });

  describe("plan", () => {
    it("should return a valid plan from LLM output", async () => {
      mockGeminiGenerate.mockResolvedValueOnce({
        response: {
          text: () =>
            JSON.stringify({
              analysis: "Need to onboard partner Red Bull",
              steps: [
                {
                  tool: "create_partner_profile",
                  args: { brand: "Red Bull", contact: "contact@redbull.com" },
                  description: "Create partner profile",
                },
              ],
            }),
        },
      });
      const plan = await supervisor.plan("Onboard Red Bull as partner");
      expect(plan.analysis).toContain("Red Bull");
      expect(plan.steps).toHaveLength(1);
      expect(plan.steps[0].tool).toBe("create_partner_profile");
    });

    it("should throw when LLM returns invalid plan", async () => {
      mockGeminiGenerate.mockResolvedValueOnce({
        response: { text: () => '{"invalid": true}' },
      });
      await expect(supervisor.plan("test")).rejects.toThrow("Plan invalide");
    });
  });
});