import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MailSummary } from './gmail';

const { create } = vi.hoisted(() => ({ create: vi.fn() }));

// The SDK is the whole network boundary here; mocking the client lets these
// tests pin the request we build and how we read the reply, without a key.
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create };
  },
}));

const { rankMail, TOP_N } = await import('./importantMail');

const mail = (id: string, over: Partial<MailSummary> = {}): MailSummary => ({
  id,
  from: `Sender ${id} <${id}@example.com>`,
  subject: `Subject ${id}`,
  snippet: `Snippet ${id}`,
  receivedAt: Date.now() - 3_600_000,
  unread: true,
  ...over,
});

/** A successful structured-output reply naming `ids`. */
const reply = (ids: string[]) => ({
  stop_reason: 'end_turn',
  content: [
    {
      type: 'text',
      text: JSON.stringify({ picks: ids.map((id) => ({ id, reason: `because ${id}` })) }),
    },
  ],
});

beforeEach(() => create.mockReset());

describe('rankMail', () => {
  it('returns the model’s picks resolved back to their messages, in order', async () => {
    create.mockResolvedValue(reply(['c', 'a', 'b']));

    const picks = await rankMail([mail('a'), mail('b'), mail('c')], 'sk-ant-test');

    expect(picks.map((p) => p.message.id)).toEqual(['c', 'a', 'b']);
    expect(picks[0].reason).toBe('because c');
  });

  it('never calls the API for an empty inbox', async () => {
    await expect(rankMail([], 'sk-ant-test')).resolves.toEqual([]);
    expect(create).not.toHaveBeenCalled();
  });

  it('sends only metadata — no message bodies exist to leak', async () => {
    create.mockResolvedValue(reply(['a']));

    await rankMail([mail('a', { subject: 'Q3 numbers', snippet: 'the short preview' })], 'k');

    const prompt = create.mock.calls[0][0].messages[0].content as string;
    expect(prompt).toContain('Q3 numbers');
    expect(prompt).toContain('the short preview');
    // The summary type has no body field at all; this pins that the prompt is
    // built from the summary rather than from anything richer.
    expect(prompt).not.toMatch(/body/i);
  });

  it('asks for the model and settings the panel is costed around', async () => {
    create.mockResolvedValue(reply(['a']));

    await rankMail([mail('a')], 'k');

    const request = create.mock.calls[0][0];
    expect(request.model).toBe('claude-opus-5');
    expect(request.output_config.effort).toBe('low');
    // Structured outputs, not "reply with JSON" — prefill is rejected on Opus 5.
    expect(request.output_config.format.type).toBe('json_schema');
  });

  it('caps the result at the number the panel shows', async () => {
    create.mockResolvedValue(reply(['a', 'b', 'c', 'd', 'e']));

    const picks = await rankMail([...'abcde'].map((c) => mail(c)), 'k');

    expect(picks).toHaveLength(TOP_N);
  });

  it('drops a pick naming a message that was never sent', async () => {
    // A hallucinated id would otherwise render as an empty row.
    create.mockResolvedValue(reply(['a', 'not-a-real-id']));

    const picks = await rankMail([mail('a')], 'k');

    expect(picks.map((p) => p.message.id)).toEqual(['a']);
  });

  it('reports a refusal instead of returning an empty list', async () => {
    create.mockResolvedValue({ stop_reason: 'refusal', content: [] });

    await expect(rankMail([mail('a')], 'k')).rejects.toThrow(/declined/i);
  });

  it('reports a reply with no text block', async () => {
    create.mockResolvedValue({ stop_reason: 'end_turn', content: [] });

    await expect(rankMail([mail('a')], 'k')).rejects.toThrow(/no ranking/i);
  });

});
