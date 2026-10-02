import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { log } from "../config";
import { SYSTEM_PROMPT } from "./prompt";
import { EVALUATION_TOOL, TOOL_NAME, type EvaluationOutput } from "./schema";

const MAX_TOKENS = 4000;
// The first call plus one retry that carries the validation error.
const MAX_CALLS = 2;

// Reads ANTHROPIC_API_KEY from the environment.
const client = new Anthropic({ maxRetries: 2, timeout: 120_000 });

// Filled in as calls return, so the tokens are known even when the
// evaluation fails afterwards.
export type Meter = {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  durationMs: number;
};

export function newMeter(): Meter {
  return {
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    durationMs: 0,
  };
}

type Schema = z.ZodType<EvaluationOutput>;

async function call(model: string, messages: Anthropic.MessageParam[], meter: Meter) {
  const started = Date.now();
  try {
    // No temperature: the configured model rejects the parameter.
    // Thinking is off because a forced tool call does not use it.
    const response = await client.messages.create({
      model,
      max_tokens: MAX_TOKENS,
      thinking: { type: "disabled" },
      system: [
        { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
      ],
      tools: [EVALUATION_TOOL],
      tool_choice: { type: "tool", name: TOOL_NAME },
      messages,
    });

    meter.calls += 1;
    meter.inputTokens += response.usage.input_tokens;
    meter.outputTokens += response.usage.output_tokens;
    meter.cacheCreationTokens += response.usage.cache_creation_input_tokens ?? 0;
    meter.cacheReadTokens += response.usage.cache_read_input_tokens ?? 0;
    return response;
  } catch (error) {
    if (error instanceof Anthropic.APIError) {
      // The API message can be long and technical. Keep the stored one short.
      throw new Error(
        `Evaluation request failed (${error.status ?? "no response"} ${error.name}).`,
        { cause: error },
      );
    }
    throw error;
  } finally {
    meter.durationMs += Date.now() - started;
  }
}

function describeIssues(error: z.ZodError) {
  return error.issues
    .map((issue) => `- ${issue.path.join(".") || "input"}: ${issue.message}`)
    .join("\n");
}

// label is the submission id, used only in log lines.
export async function requestEvaluation(
  label: string,
  model: string,
  content: Anthropic.ContentBlockParam[],
  schema: Schema,
  meter: Meter,
): Promise<EvaluationOutput> {
  const messages: Anthropic.MessageParam[] = [{ role: "user", content }];

  for (let attempt = 1; ; attempt++) {
    const response = await call(model, messages, meter);

    if (response.stop_reason === "refusal") {
      throw new Error("The model declined to evaluate this resume.");
    }
    if (response.stop_reason === "max_tokens") {
      throw new Error("The evaluation was cut off before it finished.");
    }
    const toolUse = response.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
    );
    if (!toolUse) throw new Error("The model did not return an evaluation.");

    const parsed = schema.safeParse(toolUse.input);
    if (parsed.success) return parsed.data;

    const issues = describeIssues(parsed.error);
    if (attempt === MAX_CALLS) {
      throw new Error(`The evaluation failed validation twice:\n${issues}`);
    }
    log(`${label} evaluation rejected, asking again: ${issues.replace(/\n/g, " ")}`);
    messages.push(
      { role: "assistant", content: response.content },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: toolUse.id,
            is_error: true,
            content: `The evaluation was rejected. Fix these problems and call ${TOOL_NAME} again:\n${issues}`,
          },
        ],
      },
    );
  }
}
