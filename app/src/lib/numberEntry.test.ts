import { describe, expect, it } from 'vitest';
import { numberEntryText, parseNumberEntry } from './numberEntry';

describe('numeric setting entry', () => {
  const optional = { emptyValue: 0, placeholder: 'Non renseignée' };

  it('shows unconfigured values as empty and preserves actual personal values', () => {
    expect(numberEntryText(0, optional)).toBe('');
    expect(numberEntryText(233, optional)).toBe('233');
    expect(numberEntryText(0, {})).toBe('0');
    expect(parseNumberEntry('', 0, 2000, 1, optional)).toEqual({ value: 0 });
    expect(parseNumberEntry('233', 0, 2000, 1, optional)).toEqual({ value: 233 });
  });

  it('rejects invalid or out-of-range drafts without rounding or clamping a personal threshold', () => {
    for (const draft of ['abc', '-', '-5', '241', '180.5', '1e2', 'Infinity']) {
      expect(parseNumberEntry(draft, 0, 240, 1, optional)).toHaveProperty('error');
    }
    expect(parseNumberEntry(' 185 ', 0, 240, 1, optional)).toEqual({ value: 185 });
    expect(parseNumberEntry('0', 0, 240, 1, optional)).toEqual({ value: 0 });
  });

  it('requires a value for nonoptional settings and supports decimal steps', () => {
    expect(parseNumberEntry('', 0, 100, 1, {})).toHaveProperty('error');
    expect(parseNumberEntry('2,3', 0.1, 10, 0.1, {})).toEqual({ value: 2.3 });
    expect(parseNumberEntry('2.35', 0.1, 10, 0.1, {})).toHaveProperty('error');
  });
});
