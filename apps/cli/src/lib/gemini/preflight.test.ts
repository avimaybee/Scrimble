import { describe, it, expect } from 'vitest';
import { detectHeadlessAuth, formatPreflightResult } from './preflight.js';
import type { PreflightResult } from '@scrimble/shared';

// Note: Full integration tests for preflight require mocking spawn/exec
// These tests cover formatting and result structure

describe('Gemini Preflight', () => {
  describe('detectHeadlessAuth', () => {
    it('treats API key auth as available', async () => {
      const originalGeminiApiKey = process.env['GEMINI_API_KEY'];
      const originalGoogleApiKey = process.env['GOOGLE_API_KEY'];
      process.env['GEMINI_API_KEY'] = 'test-key';
      delete process.env['GOOGLE_API_KEY'];

      try {
        const status = await detectHeadlessAuth();
        expect(status.available).toBe(true);
      } finally {
        if (originalGeminiApiKey === undefined) {
          delete process.env['GEMINI_API_KEY'];
        } else {
          process.env['GEMINI_API_KEY'] = originalGeminiApiKey;
        }
        if (originalGoogleApiKey === undefined) {
          delete process.env['GOOGLE_API_KEY'];
        } else {
          process.env['GOOGLE_API_KEY'] = originalGoogleApiKey;
        }
      }
    });
  });

  describe('formatPreflightResult', () => {
    it('formats successful preflight result', () => {
      const result: PreflightResult = {
        gemini: { available: true, path: 'gemini', version: '1.2.3' },
        headlessAuth: { available: true },
        folderTrust: { enabled: true, workspaceTrusted: true },
        canProceed: true,
        warnings: [],
        errors: [],
      };

      const formatted = formatPreflightResult(result);

      expect(formatted).toContain('✓ Gemini CLI: v1.2.3');
      expect(formatted).toContain('✓ Headless Auth: configured');
      expect(formatted).toContain('✓ Folder Trust: workspace trusted');
      expect(formatted).toContain('Ready to proceed');
    });

    it('formats failed preflight result with errors', () => {
      const result: PreflightResult = {
        gemini: { available: false, error: 'Gemini CLI not found' },
        headlessAuth: { available: false, error: 'Auth not configured' },
        folderTrust: { enabled: true, workspaceTrusted: false },
        canProceed: false,
        warnings: ['Workspace not trusted'],
        errors: ['Gemini CLI not found', 'Auth not configured'],
      };

      const formatted = formatPreflightResult(result);

      expect(formatted).toContain('✗ Gemini CLI: Gemini CLI not found');
      expect(formatted).toContain('✗ Headless Auth: Auth not configured');
      expect(formatted).toContain('⚠ Folder Trust: workspace not trusted');
      expect(formatted).toContain('Cannot proceed');
      expect(formatted).toContain('Warnings:');
    });

    it('handles folder trust disabled', () => {
      const result: PreflightResult = {
        gemini: { available: true, path: 'gemini', version: '1.0.0' },
        headlessAuth: { available: true },
        folderTrust: { enabled: false, workspaceTrusted: false },
        canProceed: true,
        warnings: [],
        errors: [],
      };

      const formatted = formatPreflightResult(result);
      expect(formatted).toContain('✓ Folder Trust: disabled (all folders trusted)');
    });
  });
});
