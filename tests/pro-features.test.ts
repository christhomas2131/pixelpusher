import { describe, it, expect } from 'vitest';
import {
  requiresPro,
  proRequiredError,
  parseProRequiredError,
  PRO_FEATURES,
  FREE_FILE_CAP,
  FREE_DUPE_GROUPS_CAP,
  PURCHASE_URL,
  PRICE_LABEL,
} from '../src/shared/pro-features';

describe('requiresPro', () => {
  it('returns true for free tier across every feature', () => {
    for (const f of PRO_FEATURES) {
      expect(requiresPro(f, 'free')).toBe(true);
    }
  });

  it('returns false for pro tier across every feature', () => {
    for (const f of PRO_FEATURES) {
      expect(requiresPro(f, 'pro')).toBe(false);
    }
  });
});

describe('proRequiredError / parseProRequiredError round-trip', () => {
  it('round-trips for each feature', () => {
    for (const f of PRO_FEATURES) {
      const err = proRequiredError(f, 'because reasons');
      const parsed = parseProRequiredError(err.message);
      expect(parsed).toEqual({ feature: f, reason: 'because reasons' });
    }
  });

  it('preserves colons inside the reason', () => {
    const err = proRequiredError('ai_search', 'AI search needs Pro: see https://x.y for details');
    const parsed = parseProRequiredError(err.message);
    expect(parsed?.feature).toBe('ai_search');
    expect(parsed?.reason).toBe('AI search needs Pro: see https://x.y for details');
  });

  it('extracts from an IPC-wrapped error message', () => {
    const wrapped = `Error invoking remote method 'organize:start': Error: PRO_REQUIRED:unlimited_organize:Free tier organizes up to 5,000 files.`;
    const parsed = parseProRequiredError(wrapped);
    expect(parsed).toEqual({
      feature: 'unlimited_organize',
      reason: 'Free tier organizes up to 5,000 files.',
    });
  });
});

describe('parseProRequiredError negative cases', () => {
  it('returns null for unrelated messages', () => {
    expect(parseProRequiredError('Something went wrong')).toBeNull();
    expect(parseProRequiredError('')).toBeNull();
    expect(parseProRequiredError('FREE_TIER_LIMIT: old format')).toBeNull();
  });

  it('returns null for an unknown feature name', () => {
    expect(parseProRequiredError('PRO_REQUIRED:not_a_real_feature:reason')).toBeNull();
  });

  it('returns null when the message has no separator after the feature', () => {
    expect(parseProRequiredError('PRO_REQUIRED:ai_search')).toBeNull();
  });
});

describe('shared constants', () => {
  it('FREE_FILE_CAP is the agreed 5000', () => {
    expect(FREE_FILE_CAP).toBe(5000);
  });

  it('FREE_DUPE_GROUPS_CAP is a positive number', () => {
    expect(FREE_DUPE_GROUPS_CAP).toBeGreaterThan(0);
  });

  it('PURCHASE_URL is an https URL', () => {
    expect(PURCHASE_URL).toMatch(/^https:\/\//);
  });

  it('PRICE_LABEL is non-empty', () => {
    expect(PRICE_LABEL.length).toBeGreaterThan(0);
  });
});
