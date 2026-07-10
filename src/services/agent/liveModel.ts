import { DIRAC_API_URL } from '../../config/dirac';
import type { AgentToolSchema, ModelPort, ModelReply, ModelRequest } from './interfaces';

export interface HttpModelOptions {
  apiKey: string;
  model: string;
  maxTokens?: number;
}

interface AnthropicContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

interface AnthropicResponse {
  content?: AnthropicContentBlock[];
  stop_reason?: string;
}

function toAnthropicTools(tools: AgentToolSchema[]): Array<Record<string, unknown>> {
  return tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema }));
}

function toAnthropicMessages(messages: ModelRequest['messages']): Array<Record<string, unknown>> {
  return messages.map((m) => ({ role: m.role, content: m.content }));
}

const DEFAULT_MAX_TOKENS = 4096;

/**
 * Non-streaming HTTP implementation of ModelPort — a single POST per turn to
 * the same Anthropic Messages endpoint useDirac.ts already calls, just
 * without `stream: true`. No test exercises the network path; it's thin by
 * design so the orchestrator's tool loop can be tested entirely against
 * mock ModelPort implementations.
 */
export class HttpModel implements ModelPort {
  private readonly options: HttpModelOptions;

  constructor(options: HttpModelOptions) {
    this.options = options;
  }

  async complete(req: ModelRequest): Promise<ModelReply> {
    const response = await fetch(DIRAC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.options.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: this.options.model,
        max_tokens: this.options.maxTokens ?? DEFAULT_MAX_TOKENS,
        system: req.system,
        messages: toAnthropicMessages(req.messages),
        tools: toAnthropicTools(req.tools),
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`Dirac agent model call failed: HTTP ${response.status} ${errorText}`.trim());
    }

    const data = (await response.json()) as AnthropicResponse;
    const blocks = Array.isArray(data.content) ? data.content : [];

    const text = blocks
      .filter((b): b is AnthropicContentBlock & { text: string } => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('');

    const toolUses = blocks
      .filter(
        (b): b is AnthropicContentBlock & { id: string; name: string } =>
          b.type === 'tool_use' && typeof b.id === 'string' && typeof b.name === 'string',
      )
      .map((b) => ({ id: b.id, name: b.name, input: b.input ?? {} }));

    return { text, toolUses, stopReason: data.stop_reason ?? 'end_turn' };
  }
}
