import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import crypto from "node:crypto";
import {
  IBISMapOpSchema,
  type DialogueSession,
  type IBISMapOp,
  type IBISNode,
  type IBISOpBatch,
  type TranscriptTurn,
} from "../../shared/schemas/models";
import type { MapperConfigInfo } from "../../shared/schemas/events";
import {
  CONKLIN_DIALOGUE_MAPPING_SYSTEM_PROMPT,
  buildMappingUserPrompt,
} from "./prompt";
import { z } from "zod";

const execFileAsync = promisify(execFile);

const LLMResponseSchema = z.object({
  summary: z.string().optional(),
  ops: z.array(IBISMapOpSchema).default([]),
});

export interface RuntimeMapperConfig {
  mode: "llm" | "heuristic" | "agent-only";
  provider:
    | "claude-cli"
    | "codex-cli"
    | "openai-compatible"
    | "anthropic"
    | "heuristic";
  baseUrl: string;
  model: string;
  apiKey: string;
}

function commandExists(cmd: string): boolean {
  try {
    execFileSync("which", [cmd], { stdio: "ignore", timeout: 2500 });
    return true;
  } catch {
    return false;
  }
}

const HAS_CLAUDE_CLI = commandExists("claude");
const HAS_CODEX_CLI = commandExists("codex");

function detectInitialConfig(): RuntimeMapperConfig {
  const anthropicKey = process.env.ANTHROPIC_API_KEY || "";
  const openaiKey = process.env.OPENAI_API_KEY || "";
  const xaiKey = process.env.XAI_API_KEY || "";
  const explicitProvider = process.env.DIALOGGER_LLM_PROVIDER as
    | RuntimeMapperConfig["provider"]
    | undefined;
  const explicitBaseUrl = process.env.DIALOGGER_LLM_BASE_URL || "";
  const explicitModel = process.env.DIALOGGER_LLM_MODEL || "";

  // Prefer Claude Code CLI (Sonnet via existing subscription — smarter than gpt-4.1-mini, $0 extra API cost!)
  if (
    explicitProvider === "claude-cli" ||
    (!explicitProvider && HAS_CLAUDE_CLI)
  ) {
    return {
      mode: "llm",
      provider: "claude-cli",
      baseUrl: "local://claude-cli",
      model: explicitModel || "sonnet",
      apiKey: "",
    };
  }

  if (
    explicitProvider === "codex-cli" ||
    (!explicitProvider && HAS_CODEX_CLI)
  ) {
    return {
      mode: "llm",
      provider: "codex-cli",
      baseUrl: "local://codex-cli",
      model: explicitModel || "gpt-5.4",
      apiKey: "",
    };
  }

  if (explicitProvider === "anthropic" || (!explicitProvider && anthropicKey)) {
    return {
      mode: anthropicKey ? "llm" : "heuristic",
      provider: "anthropic",
      baseUrl: explicitBaseUrl || "https://api.anthropic.com/v1",
      model: explicitModel || "claude-sonnet-4-5",
      apiKey: anthropicKey,
    };
  }

  if (openaiKey) {
    return {
      mode: "llm",
      provider: "openai-compatible",
      baseUrl: explicitBaseUrl || "https://api.openai.com/v1",
      model: explicitModel || "gpt-4.1-mini",
      apiKey: openaiKey,
    };
  }

  if (xaiKey) {
    return {
      mode: "llm",
      provider: "openai-compatible",
      baseUrl: explicitBaseUrl || "https://api.x.ai/v1",
      model: explicitModel || "grok-3-mini",
      apiKey: xaiKey,
    };
  }

  if (explicitBaseUrl && explicitModel) {
    return {
      mode: "llm",
      provider: "openai-compatible",
      baseUrl: explicitBaseUrl,
      model: explicitModel,
      apiKey: "",
    };
  }

  return {
    mode: "heuristic",
    provider: "heuristic",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4.1-mini",
    apiKey: "",
  };
}

export class DialogueMapperEngine {
  private config: RuntimeMapperConfig = detectInitialConfig();

  getPublicConfig(): MapperConfigInfo {
    return {
      mode: this.config.mode,
      provider: this.config.provider,
      baseUrl: this.config.baseUrl,
      model: this.config.model,
      hasApiKey: Boolean(this.config.apiKey),
      claudeCliAvailable: HAS_CLAUDE_CLI,
      codexCliAvailable: HAS_CODEX_CLI,
    };
  }

  updateConfig(
    patch: Partial<{
      mode: RuntimeMapperConfig["mode"];
      provider: RuntimeMapperConfig["provider"];
      baseUrl: string;
      model: string;
      apiKey: string;
    }>
  ): MapperConfigInfo {
    const nextProvider = patch.provider ?? this.config.provider;
    const nextBaseUrl =
      patch.baseUrl !== undefined ? patch.baseUrl.trim() : this.config.baseUrl;
    const destinationChanged =
      nextProvider !== this.config.provider ||
      nextBaseUrl !== this.config.baseUrl;

    if (patch.mode) this.config.mode = patch.mode;
    this.config.provider = nextProvider;
    this.config.baseUrl = nextBaseUrl;
    if (patch.model !== undefined) this.config.model = patch.model.trim();

    // Bind API keys strictly to their provider and endpoint so changing destination
    // can never forward an existing credential to a different server.
    if (patch.apiKey !== undefined && patch.apiKey.trim() !== "") {
      this.config.apiKey = patch.apiKey.trim();
    } else if (destinationChanged) {
      this.config.apiKey = resolveEnvKeyForDestination(nextProvider, nextBaseUrl);
    }
    return this.getPublicConfig();
  }

  async analyzeTurns(
    session: DialogueSession,
    turns: TranscriptTurn[]
  ): Promise<IBISOpBatch> {
    if (turns.length === 0) {
      return {
        actor: "model",
        summary: "No unmapped turns to analyze",
        markTurnIdsMapped: [],
        ops: [],
      };
    }

    if (this.config.mode === "agent-only") {
      return {
        actor: "agent",
        summary: "Agent-only mode active; waiting for external agent ops",
        markTurnIdsMapped: [],
        ops: [],
      };
    }

    if (this.config.mode === "llm" && this.config.provider !== "heuristic") {
      const isCli =
        this.config.provider === "claude-cli" ||
        this.config.provider === "codex-cli";
      const isLocalHttp = isLocalHttpUrl(this.config.baseUrl);

      if (isCli || this.config.apiKey || isLocalHttp) {
        try {
          return await this.runLLMMapper(session, turns);
        } catch (err) {
          console.warn(
            `[mapper] ${this.config.provider} (${this.config.model}) failed, falling back to heuristic mapper:`,
            err
          );
        }
      }
    }

    return this.runHeuristicMapper(session, turns);
  }

  private async runLLMMapper(
    session: DialogueSession,
    turns: TranscriptTurn[]
  ): Promise<IBISOpBatch> {
    const userPrompt = buildMappingUserPrompt(session, turns);
    let rawText = "";

    if (this.config.provider === "claude-cli") {
      const { stdout } = await execFileAsync(
        "claude",
        [
          "-p",
          "--model",
          this.config.model || "sonnet",
          "--tools",
          "",
          "--no-session-persistence",
          "--output-format",
          "json",
          "--system-prompt",
          CONKLIN_DIALOGUE_MAPPING_SYSTEM_PROMPT,
          userPrompt,
        ],
        {
          timeout: 90_000,
          maxBuffer: 16 * 1024 * 1024,
        }
      );
      const envelope = JSON.parse(stdout.trim()) as {
        result?: string;
        is_error?: boolean;
      };
      if (envelope.is_error || !envelope.result) {
        throw new Error(`Claude CLI error: ${stdout.slice(0, 240)}`);
      }
      rawText = envelope.result;
    } else if (this.config.provider === "codex-cli") {
      const combinedPrompt = `${CONKLIN_DIALOGUE_MAPPING_SYSTEM_PROMPT}\n\n---\n\n${userPrompt}`;
      const args = ["exec", "--skip-git-repo-check"];
      if (this.config.model) {
        args.push("--model", this.config.model);
      }
      args.push(combinedPrompt);
      const { stdout } = await execFileAsync("codex", args, {
        timeout: 90_000,
        maxBuffer: 16 * 1024 * 1024,
      });
      rawText = stdout;
    } else if (this.config.provider === "anthropic") {
      const url = `${this.config.baseUrl.replace(/\/$/, "")}/messages`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": this.config.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: this.config.model,
          max_tokens: 1800,
          temperature: 0.2,
          system: CONKLIN_DIALOGUE_MAPPING_SYSTEM_PROMPT,
          messages: [{ role: "user", content: userPrompt }],
        }),
        signal: AbortSignal.timeout(45_000),
      });
      if (!res.ok) {
        throw new Error(`Anthropic API HTTP ${res.status}: ${await res.text()}`);
      }
      const data = (await res.json()) as {
        content?: Array<{ type: string; text?: string }>;
      };
      rawText = data.content?.find((c) => c.type === "text")?.text || "{}";
    } else {
      const url = `${this.config.baseUrl.replace(/\/$/, "")}/chat/completions`;
      const headers: Record<string, string> = {
        "content-type": "application/json",
      };
      if (this.config.apiKey) {
        headers.authorization = `Bearer ${this.config.apiKey}`;
      }
      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: this.config.model,
          temperature: 0.2,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: CONKLIN_DIALOGUE_MAPPING_SYSTEM_PROMPT },
            { role: "user", content: userPrompt },
          ],
        }),
        signal: AbortSignal.timeout(45_000),
      });
      if (!res.ok) {
        throw new Error(`LLM API HTTP ${res.status}: ${await res.text()}`);
      }
      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      rawText = data.choices?.[0]?.message?.content || "{}";
    }

    const jsonText = extractJsonObject(rawText);
    const parsed = LLMResponseSchema.parse(JSON.parse(jsonText));

    return {
      actor: "model",
      summary:
        parsed.summary ||
        `Mapped ${turns.length} turn(s) via ${this.config.provider}:${this.config.model}`,
      markTurnIdsMapped: turns.map((t) => t.id),
      ops: parsed.ops,
    };
  }

  /**
   * Deterministic offline Conklin IBIS heuristic mapper.
   */
  runHeuristicMapper(
    session: DialogueSession,
    turns: TranscriptTurn[]
  ): IBISOpBatch {
    const ops: IBISMapOp[] = [];
    const virtualNodes: Array<{
      id: string;
      type: IBISNode["type"];
      parentId: string | null;
    }> = session.nodes.map((n) => ({
      id: n.id,
      type: n.type,
      parentId: n.parentId,
    }));

    const makeId = (prefix: string) =>
      `${prefix}_${crypto.randomBytes(3).toString("hex")}`;

    const lastOfType = (type: IBISNode["type"]) => {
      for (let i = virtualNodes.length - 1; i >= 0; i--) {
        if (virtualNodes[i].type === type) return virtualNodes[i].id;
      }
      return null;
    };

    const ensureRootQuestion = (turn: TranscriptTurn): string => {
      const existingQ = lastOfType("question");
      if (existingQ) return existingQ;
      const qId = makeId("q");
      const label =
        session.rootFocus ||
        (session.title && session.title !== "Untitled Dialogue Map"
          ? `How should we approach ${session.title}?`
          : "What is the core question we need to resolve?");
      ops.push({
        op: "add_node",
        id: qId,
        type: "question",
        label,
        parentId: null,
        relationLabel: "root",
        turnIds: [turn.id],
        speakerIds: [turn.speakerId],
      });
      virtualNodes.push({ id: qId, type: "question", parentId: null });
      return qId;
    };

    for (const turn of turns) {
      const raw = turn.text.trim();
      if (raw.length < 4) continue;

      const introMatch = raw.match(
        /\b(?:[Ii]'?m|[Mm]y name is|[Tt]his is)\s+([A-Z][a-z]{1,20})\b/
      );
      if (introMatch) {
        ops.push({
          op: "rename_speaker",
          speakerId: turn.speakerId,
          name: introMatch[1],
        });
      }

      const sentences = raw
        .split(/(?<=[.?!])\s+/)
        .map((s) => s.trim())
        .filter((s) => s.length >= 6);

      const parts = sentences.length > 0 ? sentences : [raw];

      for (const sentence of parts) {
        const lower = sentence.toLowerCase();
        const distilled = distillLabel(sentence);
        if (!distilled) continue;

        // Skip pure marketing / sponsor reads
        if (
          /\b(subscribe to our|promo code|discount code|check out our sponsor|brought to you by|use code)\b/.test(
            lower
          )
        ) {
          continue;
        }

        // Classify procedural host / moderator context at session level (off the IBIS map)
        const hostCategory = classifyHostContext(lower);
        if (hostCategory) {
          ops.push({
            op: "add_host_context",
            id: makeId("hc"),
            category: hostCategory,
            summary: distilled,
            turnIds: [turn.id],
            speakerIds: [turn.speakerId],
          });
          continue;
        }

        const isDecision =
          /\b(let'?s commit|we'?re aligned|agreed|let'?s go with|we decided|decision:|ship it|consensus|sounds like a plan|settled on)\b/.test(
            lower
          );
        const isQuestion =
          sentence.endsWith("?") ||
          /^(how|what|why|should|could|would|which|when|where|can we|do we|is it)\b/.test(
            lower
          );
        const isCon =
          /\b(concern|worried|worry|risk|downside|problem|issue is|drawback|however|my only hesitation|choke|expensive|hard to|blocks?|danger|objection|wait,|hold on|but if|trade-?off)\b/.test(
            lower
          );
        const isPro =
          /\b(huge plus|benefit|advantage|great because|love that|works well|faster|saves|helps|pro:|plus,|supports|strength|eliminates|zero .* leaves)\b/.test(
            lower
          );
        const isIdea =
          /\b(we could|we should|i'?d|i propose|what about|alternatively|option|let'?s|why don'?t we|how about|suggest|recommend|build|use|run|expose|adopt)\b/.test(
            lower
          );

        if (isDecision) {
          const parentId = lastOfType("idea") || ensureRootQuestion(turn);
          const id = makeId("d");
          ops.push({
            op: "add_node",
            id,
            type: "decision",
            label: distilled,
            parentId,
            relationLabel: "decides",
            turnIds: [turn.id],
            speakerIds: [turn.speakerId],
          });
          virtualNodes.push({ id, type: "decision", parentId });
        } else if (isQuestion) {
          const parentId =
            virtualNodes.length === 0
              ? null
              : lastOfType("con") || lastOfType("idea") || lastOfType("question");
          const id = makeId("q");
          const qLabel = distilled.endsWith("?") ? distilled : `${distilled}?`;
          ops.push({
            op: "add_node",
            id,
            type: "question",
            label: qLabel,
            parentId,
            relationLabel: parentId ? "questions" : "root",
            turnIds: [turn.id],
            speakerIds: [turn.speakerId],
          });
          virtualNodes.push({ id, type: "question", parentId });
        } else if (isCon) {
          const parentId = lastOfType("idea") || ensureRootQuestion(turn);
          const id = makeId("c");
          ops.push({
            op: "add_node",
            id,
            type: "con",
            label: distilled,
            parentId,
            relationLabel: "objects to",
            turnIds: [turn.id],
            speakerIds: [turn.speakerId],
          });
          virtualNodes.push({ id, type: "con", parentId });
        } else if (isPro) {
          const parentId = lastOfType("idea") || ensureRootQuestion(turn);
          const id = makeId("p");
          ops.push({
            op: "add_node",
            id,
            type: "pro",
            label: distilled,
            parentId,
            relationLabel: "supports",
            turnIds: [turn.id],
            speakerIds: [turn.speakerId],
          });
          virtualNodes.push({ id, type: "pro", parentId });
        } else if (isIdea) {
          const parentId = ensureRootQuestion(turn);
          const id = makeId("i");
          ops.push({
            op: "add_node",
            id,
            type: "idea",
            label: distilled,
            parentId,
            relationLabel: "answers",
            turnIds: [turn.id],
            speakerIds: [turn.speakerId],
          });
          virtualNodes.push({ id, type: "idea", parentId });
        } else if (sentence.split(/\s+/).length >= 6) {
          const parentId =
            lastOfType("question") || lastOfType("idea") || ensureRootQuestion(turn);
          const id = makeId("n");
          ops.push({
            op: "add_node",
            id,
            type: "note",
            label: distilled,
            parentId,
            relationLabel: "context",
            turnIds: [turn.id],
            speakerIds: [turn.speakerId],
          });
          virtualNodes.push({ id, type: "note", parentId });
        }
      }
    }

    return {
      actor: "heuristic",
      summary:
        ops.length > 0
          ? `Local Conklin mapper applied ${ops.length} update${ops.length === 1 ? "" : "s"}`
          : "No substantive IBIS items detected",
      markTurnIdsMapped: turns.map((t) => t.id),
      ops,
    };
  }
}

function isLocalHttpUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    return (
      parsed.hostname === "localhost" ||
      parsed.hostname === "127.0.0.1" ||
      parsed.hostname === "::1" ||
      parsed.hostname === "[::1]"
    );
  } catch {
    return false;
  }
}

function resolveEnvKeyForDestination(
  provider: RuntimeMapperConfig["provider"],
  baseUrl: string
): string {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    return "";
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    return "";
  }
  if (provider === "anthropic") {
    return parsed.hostname === "api.anthropic.com"
      ? process.env.ANTHROPIC_API_KEY || ""
      : "";
  }
  if (provider === "openai-compatible") {
    if (parsed.hostname === "api.openai.com") {
      return process.env.OPENAI_API_KEY || "";
    }
    if (parsed.hostname === "api.x.ai") {
      return process.env.XAI_API_KEY || "";
    }
  }
  return "";
}

function classifyHostContext(
  lower: string
): "framing" | "participants" | "format" | "ground_rules" | "background" | null {
  if (
    /\b(ground rules?|time limits?|refrain from interruptions|hold applause|uninterrupted|cross[- ]?examination|direct engagement)\b/.test(
      lower
    )
  ) {
    return "ground_rules";
  }
  if (
    /\b(debate format|formatting rules|opening statements?|rebuttals?|closing arguments?|theological rounds?|audience questions|lay out the format|minute opening|minute rebuttal)\b/.test(
      lower
    )
  ) {
    return "format";
  }
  if (
    /\b(welcome (?:everyone|you|pastor|rev|dr)|host of|pleasure to welcome|arguing (?:the )?(?:affirmative|negative)|will argue (?:for|against)|author of several books)\b/.test(
      lower
    )
  ) {
    return "participants";
  }
  if (
    /\b(our topic this evening|tonight'?s debate|our purpose tonight|sponsoring this event|partnering with)\b/.test(
      lower
    )
  ) {
    return "framing";
  }
  return null;
}

function distillLabel(sentence: string): string {
  let s = sentence
    .replace(
      /^(alright everyone,?|okay,?|so,?|well,?|yeah,?|um,?|uh,?|hold on[—\-,]?|good question\.?|actually,?|basically,?|honestly,?)\s+/i,
      ""
    )
    .trim();
  if (s.length < 4) return "";
  if (s.length > 108) {
    const cut = s.slice(0, 105).replace(/\s+\S*$/, "");
    s = `${cut}…`;
  }
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function extractJsonObject(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first >= 0 && last > first) return trimmed.slice(first, last + 1);
  return trimmed;
}

export const dialogueMapper = new DialogueMapperEngine();
