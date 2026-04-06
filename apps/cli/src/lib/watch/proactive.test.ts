import { describe, expect, it } from 'vitest';
import { evaluateProactiveSignals } from './proactive.js';

describe('evaluateProactiveSignals', () => {
  it('emits verify and done-oriented signals for execution artifacts with passing verification', () => {
    const signals = evaluateProactiveSignals({
      events: [
        {
          type: 'changed',
          absolutePath: 'D:\\repo\\dist\\index.js',
          relativePath: 'dist/index.js',
          timestamp: '2026-04-06T00:00:00.000Z',
        },
      ],
      plan: {
        version: 1,
        chunks: [
          {
            id: 'chunk-001',
            title: 'Implement feature',
            prompt: 'Implement feature',
            status: 'active',
          },
        ],
      },
      verificationResult: {
        status: 'pass',
        confidence: 0.9,
        checks: [],
        timestamp: '2026-04-06T00:00:00.000Z',
      },
    });

    expect(signals.some((signal) => signal.type === 'execution-signal' && signal.suggestedCommand === 'scrimble verify')).toBe(true);
    expect(signals.some((signal) => signal.type === 'completion-ready' && signal.suggestedCommand === 'scrimble done')).toBe(true);
  });

  it('emits no-active-chunk when plan has no active chunk', () => {
    const signals = evaluateProactiveSignals({
      events: [],
      plan: {
        version: 1,
        chunks: [{ id: 'chunk-001', title: 'Todo', prompt: 'Todo', status: 'pending' }],
      },
      verificationResult: null,
    });

    expect(signals).toEqual([
      expect.objectContaining({
        type: 'no-active-chunk',
        suggestedCommand: 'scrimble next --activate',
      }),
    ]);
  });
});
