import { describe, it, expect } from 'vitest';
import { HAIKU_MODEL, SONNET_MODEL } from '../config/dirac';
import {
  shouldUseTools,
  isExplicitThink,
  hasReasoningKeyword,
  resolveThinking,
  heuristicChatModel,
  pickChatModel,
  routeChat,
  selectContextSections,
} from './diracRouting';

describe('pickChatModel', () => {
  it('passes the heuristic through on auto', () => {
    expect(pickChatModel(HAIKU_MODEL, 'auto', false)).toBe(HAIKU_MODEL);
    expect(pickChatModel(SONNET_MODEL, 'auto', false)).toBe(SONNET_MODEL);
  });

  it('forces Haiku when preferred, overriding a Sonnet heuristic', () => {
    expect(pickChatModel(SONNET_MODEL, 'haiku', false)).toBe(HAIKU_MODEL);
  });

  it('forces Sonnet when preferred, overriding a Haiku heuristic', () => {
    expect(pickChatModel(HAIKU_MODEL, 'sonnet', false)).toBe(SONNET_MODEL);
  });

  it('uses Sonnet for tool turns regardless of preference (capability wins)', () => {
    expect(pickChatModel(HAIKU_MODEL, 'haiku', true)).toBe(SONNET_MODEL);
    expect(pickChatModel(HAIKU_MODEL, 'auto', true)).toBe(SONNET_MODEL);
    expect(pickChatModel(SONNET_MODEL, 'sonnet', true)).toBe(SONNET_MODEL);
  });
});

describe('resolveThinking', () => {
  it('always honors an explicit /think, even with the toggle off', () => {
    expect(resolveThinking(true, false, false)).toBe(true);
    expect(resolveThinking(true, true, false)).toBe(true);
    expect(resolveThinking(true, false, true)).toBe(true);
  });

  it('auto-escalates on reasoning keywords only while the toggle is on', () => {
    expect(resolveThinking(false, true, true)).toBe(true);
    expect(resolveThinking(false, true, false)).toBe(false);
  });

  it('stays off with no trigger', () => {
    expect(resolveThinking(false, false, true)).toBe(false);
    expect(resolveThinking(false, false, false)).toBe(false);
  });
});

describe('thinking detection', () => {
  it('detects the explicit /think prefix', () => {
    expect(isExplicitThink('/think why is this slow')).toBe(true);
    expect(isExplicitThink('why is this slow')).toBe(false);
  });

  it('detects reasoning keywords without treating /think as one', () => {
    expect(hasReasoningKeyword('optimize my circuit depth')).toBe(true);
    expect(hasReasoningKeyword('prove these are equivalent')).toBe(true);
    expect(hasReasoningKeyword('hello there')).toBe(false);
    expect(hasReasoningKeyword('/think hello there')).toBe(false);
  });
});

describe('selectContextSections', () => {
  it('standard (the default) keeps the pre-settings assembly: everything, top-8 probabilities, last 3 errors', () => {
    expect(selectContextSections('standard')).toEqual({
      results: true,
      bloch: true,
      exercise: true,
      errors: true,
      hardware: true,
      challenge: true,
      probabilityLimit: 8,
      errorLineLimit: 3,
    });
  });

  it('minimal keeps only code + circuit + recent errors', () => {
    const plan = selectContextSections('minimal');
    expect(plan.results).toBe(false);
    expect(plan.bloch).toBe(false);
    expect(plan.exercise).toBe(false);
    expect(plan.hardware).toBe(false);
    expect(plan.challenge).toBe(false);
    expect(plan.errors).toBe(true);
  });

  it('full sends everything with deeper detail', () => {
    expect(selectContextSections('full')).toEqual({
      results: true,
      bloch: true,
      exercise: true,
      errors: true,
      hardware: true,
      challenge: true,
      probabilityLimit: 16,
      errorLineLimit: 10,
    });
  });
});

describe('routeChat with default settings (auto + extendedThinking on) reproduces the pre-settings routing', () => {
  const DEFAULTS = { preferredModel: 'auto', extendedThinking: true } as const;

  it('short simple question → Haiku, no tools, no thinking, 4096', () => {
    expect(routeChat('hi dirac', DEFAULTS)).toEqual({
      model: HAIKU_MODEL,
      thinking: false,
      tools: false,
      maxTokens: 4096,
    });
  });

  it('explain-keyword question → Sonnet, no tools', () => {
    expect(routeChat('explain entanglement', DEFAULTS)).toEqual({
      model: SONNET_MODEL,
      thinking: false,
      tools: false,
      maxTokens: 4096,
    });
  });

  it('long message (>100 chars) → Sonnet', () => {
    const long = 'so um about that thing on the bloch sphere panel yesterday, the one pointing along +y after the second moment'; // >100 chars, no keywords
    expect(long.length).toBeGreaterThan(100);
    expect(routeChat(long, DEFAULTS).model).toBe(SONNET_MODEL);
  });

  it('action keywords → Sonnet with tools', () => {
    expect(routeChat('write a bell state for me', DEFAULTS)).toEqual({
      model: SONNET_MODEL,
      thinking: false,
      tools: true,
      maxTokens: 4096,
    });
  });

  it('/think → Sonnet thinking, 16000, tools suppressed', () => {
    expect(routeChat('/think can you simplify this circuit', DEFAULTS)).toEqual({
      model: SONNET_MODEL,
      thinking: true,
      tools: false,
      maxTokens: 16000,
    });
  });

  it('reasoning keyword auto-escalates (default toggle is on)', () => {
    expect(routeChat('optimize this circuit', DEFAULTS)).toEqual({
      model: SONNET_MODEL,
      thinking: true,
      tools: false,
      maxTokens: 16000,
    });
  });
});

describe('routeChat with non-default settings', () => {
  it('preferredModel haiku forces Haiku for plain chat', () => {
    expect(routeChat('explain entanglement', { preferredModel: 'haiku', extendedThinking: true }).model)
      .toBe(HAIKU_MODEL);
  });

  it('preferredModel haiku still gets Sonnet on tool turns', () => {
    const route = routeChat('write a bell state for me', { preferredModel: 'haiku', extendedThinking: true });
    expect(route.model).toBe(SONNET_MODEL);
    expect(route.tools).toBe(true);
  });

  it('preferredModel sonnet forces Sonnet for short questions', () => {
    expect(routeChat('hi dirac', { preferredModel: 'sonnet', extendedThinking: true }).model)
      .toBe(SONNET_MODEL);
  });

  it('extendedThinking off disables keyword escalation but not /think', () => {
    const keyword = routeChat('optimize this circuit', { preferredModel: 'auto', extendedThinking: false });
    expect(keyword.thinking).toBe(false);
    expect(keyword.maxTokens).toBe(4096);

    const explicit = routeChat('/think optimize this circuit', { preferredModel: 'auto', extendedThinking: false });
    expect(explicit.thinking).toBe(true);
    expect(explicit.maxTokens).toBe(16000);
  });

  it('thinking turns run on Sonnet even when Haiku is preferred (capability wins)', () => {
    expect(routeChat('/think hello', { preferredModel: 'haiku', extendedThinking: false }).model)
      .toBe(SONNET_MODEL);
  });
});

describe('heuristics (moved verbatim from useDirac)', () => {
  it('shouldUseTools matches action keywords', () => {
    expect(shouldUseTools('write a ghz circuit')).toBe(true);
    expect(shouldUseTools('run the simulation')).toBe(true);
    expect(shouldUseTools('hello')).toBe(false);
  });

  it('heuristicChatModel: tools → Sonnet, complex → Sonnet, otherwise Haiku', () => {
    expect(heuristicChatModel('anything', true)).toBe(SONNET_MODEL);
    expect(heuristicChatModel('explain superposition', false)).toBe(SONNET_MODEL);
    expect(heuristicChatModel('hi', false)).toBe(HAIKU_MODEL);
  });
});
