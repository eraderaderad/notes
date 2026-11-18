// AI provider layer. Three options, chosen by the user in Settings:
//   anthropic  - Claude via the official SDK (cloud; sends the prompt text to Anthropic)
//   openai     - any OpenAI-compatible endpoint (cloud or local, e.g. LM Studio)
//   ollama     - local models through Ollama (nothing leaves the PC)
// Nothing here ever runs unless a provider has been explicitly configured.
import Anthropic from '@anthropic-ai/sdk';

export class AppError extends Error {
  constructor(message, code = 'ERROR') {
    super(message);
    this.code = code;
  }
}

// Models that accept the server-side refusal fallback parameter.
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-fable-5-2']);

export function aiConfig(ctx) {
  const s = ctx.settings.all();
  const provider = s.aiProvider || 'none';
  const cfg = { provider, configured: false, external: false, model: '', label: 'Not configured', reason: '' };
  if (provider === 'anthropic') {
    cfg.model = s.anthropicModel || 'claude-opus-5-5';
    cfg.label = `Claude (${cfg.model})`;
    cfg.external = true;
    cfg.configured = ctx.secrets.has('anthropicKey');
    if (!cfg.configured) cfg.reason = 'Add your Anthropic API key in Settings → AI.';
  } else if (provider === 'openai') {
    cfg.baseUrl = (s.openaiBaseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
    cfg.model = s.openaiModel || '';
    cfg.label = `OpenAI-compatible (${cfg.model || 'no model'})`;
    cfg.external = !/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/i.test(cfg.baseUrl);
    cfg.configured = !!cfg.model && (!cfg.external || ctx.secrets.has('openaiKey'));
    if (!cfg.configured) cfg.reason = 'Set the model name' + (cfg.external ? ' and API key' : '') + ' in Settings → AI.';
  } else if (provider === 'ollama') {
    cfg.baseUrl = (s.ollamaUrl || 'http://localhost:11434').replace(/\/+$/, '');
    cfg.model = s.ollamaModel || '';
    cfg.label = `Ollama (${cfg.model || 'no model'})`;
    cfg.configured = !!cfg.model;
    if (!cfg.configured) cfg.reason = 'Choose an Ollama model in Settings → AI.';
  } else {
    cfg.reason = 'No AI provider is set up yet. Choose one in Settings → AI.';
  }
  // Rough per-request source budget, in characters.
  cfg.charBudget = provider === 'ollama' ? 24000 : cfg.external ? 240000 : 48000;
  return cfg;
}

function requireConfig(ctx) {
  const cfg = aiConfig(ctx);
  if (!cfg.configured) throw new AppError(cfg.reason, 'AI_NOT_CONFIGURED');
  return cfg;
}

async function callAnthropic(ctx, cfg, { system, messages, maxTokens }) {
  const client = new Anthropic({ apiKey: ctx.secrets.get('anthropicKey') });
  const params = { model: cfg.model, max_tokens: maxTokens, system, messages };
  try {
    // Streaming avoids HTTP timeouts on long outputs; finalMessage() collects the result.
    const msg = FALLBACK_MODELS.has(cfg.model)
      ? await client.beta.messages.stream({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }).finalMessage()
      : await client.messages.stream(params).finalMessage();
    if (msg.stop_reason === 'refusal') throw new AppError('Claude declined to answer this request.', 'AI_REFUSED');
    const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    if (!text.trim() && msg.stop_reason === 'max_tokens') throw new AppError('The response was cut off before any text was produced. Try a shorter source.', 'AI_ERROR');
    return text;
  } catch (e) {
    if (e instanceof AppError) throw e;
    if (e instanceof Anthropic.AuthenticationError) throw new AppError('Anthropic rejected the API key. Check it in Settings → AI.', 'AI_AUTH');
    if (e instanceof Anthropic.PermissionDeniedError) throw new AppError('This API key is not allowed to use ' + cfg.model + '.', 'AI_AUTH');
    if (e instanceof Anthropic.NotFoundError) throw new AppError(`Model "${cfg.model}" was not found. Check the model name in Settings → AI.`, 'AI_ERROR');
    if (e instanceof Anthropic.RateLimitError) throw new AppError('Rate limited by Anthropic. Wait a moment and try again.', 'AI_RATE');
    if (e instanceof Anthropic.APIConnectionError) throw new AppError('Could not reach Anthropic. Check your internet connection.', 'AI_OFFLINE');
    if (e instanceof Anthropic.APIError) throw new AppError(`Anthropic API error ${e.status ?? ''}: ${e.message}`, 'AI_ERROR');
    throw e;
  }
}

async function postJson(url, body, headers = {}, what = 'AI service') {
  let res;
  try {
    res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  } catch {
    throw new AppError(`Could not reach ${what} at ${new URL(url).origin}. Is it running?`, 'AI_OFFLINE');
  }
  const text = await res.text();
  if (!res.ok) {
    let detail = text.slice(0, 300);
    try {
      const j = JSON.parse(text);
      detail = j.error?.message || j.error || detail;
    } catch {}
    if (res.status === 401 || res.status === 403) throw new AppError(`${what} rejected the API key.`, 'AI_AUTH');
    throw new AppError(`${what} error ${res.status}: ${detail}`, 'AI_ERROR');
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError(`${what} returned an unreadable response.`, 'AI_ERROR');
  }
}

async function callOpenAi(ctx, cfg, { system, messages, maxTokens, json }) {
  const key = ctx.secrets.get('openaiKey');
  const body = { model: cfg.model, messages: [{ role: 'system', content: system }, ...messages], max_tokens: maxTokens };
  if (json) body.response_format = { type: 'json_object' };
  const headers = key ? { authorization: `Bearer ${key}` } : {};
  let data;
  try {
    data = await postJson(`${cfg.baseUrl}/chat/completions`, body, headers, 'the AI endpoint');
  } catch (e) {
    // Some compatible servers do not support response_format or max_tokens; retry once without them.
    if (e.code !== 'AI_ERROR') throw e;
    data = await postJson(`${cfg.baseUrl}/chat/completions`, { model: cfg.model, messages: body.messages }, headers, 'the AI endpoint');
  }
  return data.choices?.[0]?.message?.content ?? '';
}

async function callOllama(_ctx, cfg, { system, messages, json }) {
  const body = { model: cfg.model, stream: false, messages: [{ role: 'system', content: system }, ...messages], options: { num_ctx: 16384 } };
  if (json) body.format = 'json';
  const data = await postJson(`${cfg.baseUrl}/api/chat`, body, {}, 'Ollama');
  return data.message?.content ?? '';
}

/** Run one completion with the configured provider. Returns plain text. */
export async function complete(ctx, { system, messages, user, maxTokens = 16000, json = false }) {
  const cfg = requireConfig(ctx);
  const req = { system, messages: messages || [{ role: 'user', content: user }], maxTokens, json };
  const text = cfg.provider === 'anthropic' ? await callAnthropic(ctx, cfg, req) : cfg.provider === 'openai' ? await callOpenAi(ctx, cfg, req) : await callOllama(ctx, cfg, req);
  if (!text || !text.trim()) throw new AppError('The AI returned an empty response. Try again.', 'AI_ERROR');
  return text.trim();
}

/** Run a completion that must return a JSON object. */
export async function completeJson(ctx, opts) {
  const text = await complete(ctx, { ...opts, json: true });
  return extractJson(text);
}

export function extractJson(text) {
  let t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a === -1 || b <= a) throw new AppError('The AI did not return structured data. Try again, or use a more capable model.', 'AI_ERROR');
  t = t.slice(a, b + 1);
  try {
    return JSON.parse(t);
  } catch {
    try {
      return JSON.parse(t.replace(/,\s*([}\]])/g, '$1'));
    } catch {
      throw new AppError('The AI returned malformed data. Try again, or use a more capable model.', 'AI_ERROR');
    }
  }
}

export async function listOllamaModels(baseUrl) {
  try {
    const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return { running: false, models: [] };
    const j = await res.json();
    return { running: true, models: (j.models || []).map((m) => m.name) };
  } catch {
    return { running: false, models: [] };
  }
}
