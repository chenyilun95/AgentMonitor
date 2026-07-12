import { en } from './locales/en';
import { zh } from './locales/zh';

export type Language = 'en' | 'zh';

export const translations: Record<Language, Record<string, string>> = {
  en,
  zh,
};
