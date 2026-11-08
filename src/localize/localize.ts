import en from './languages/en.json';
import sv from './languages/sv.json';

export type SupportedLanguage = 'en' | 'sv';
export type Replacements = Record<string, string | number>;

const languages: Record<SupportedLanguage, Record<string, unknown>> = { en, sv };

function resolveTranslation(path: string, dictionary: Record<string, unknown>): string | undefined {
  const value = path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object' && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key];
    }

    return undefined;
  }, dictionary);

  return typeof value === 'string' ? value : undefined;
}

export function normalizeLanguage(locale = 'en-US'): SupportedLanguage {
  const primaryLanguage = locale.replace('_', '-').toLowerCase().split('-')[0];
  return primaryLanguage === 'sv' ? 'sv' : 'en';
}

export function localize(key: string, locale = 'en-US', replacements: Replacements = {}): string {
  const translated =
    resolveTranslation(key, languages[normalizeLanguage(locale)]) ?? resolveTranslation(key, en) ?? key;

  return translated.replace(/\{(\w+)\}/g, (match, token: string) =>
    token in replacements ? String(replacements[token]) : match,
  );
}
