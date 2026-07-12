import { describe, it, expect } from 'vitest';
import { en } from '../../src/i18n/locales/en';
import { zh } from '../../src/i18n/locales/zh';

describe('i18n locale completeness', () => {
  const enKeys = Object.keys(en).sort();
  const zhKeys = Object.keys(zh).sort();

  it('en and zh have the same number of keys', () => {
    expect(enKeys.length).toBe(zhKeys.length);
  });

  it('every en key exists in zh', () => {
    const missing = enKeys.filter(k => !(k in zh));
    expect(missing).toEqual([]);
  });

  it('every zh key exists in en', () => {
    const extra = zhKeys.filter(k => !(k in en));
    expect(extra).toEqual([]);
  });

  it('no locale values are empty strings', () => {
    const emptyEn = enKeys.filter(k => en[k] === '');
    const emptyZh = zhKeys.filter(k => zh[k] === '');
    expect(emptyEn).toEqual([]);
    expect(emptyZh).toEqual([]);
  });

  it('no locale values are just the key name', () => {
    const selfRefEn = enKeys.filter(k => en[k] === k);
    const selfRefZh = zhKeys.filter(k => zh[k] === k);
    expect(selfRefEn).toEqual([]);
    expect(selfRefZh).toEqual([]);
  });
});
