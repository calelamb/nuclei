import { create } from 'zustand';
import { en } from './en';
import { es } from './es';
import { zh } from './zh';
import { ja } from './ja';

export type Locale = 'en' | 'es' | 'zh' | 'ja';

interface I18nState {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

export const useI18nStore = create<I18nState>((set) => ({
  locale: 'en',
  setLocale: (locale) => set({ locale }),
}));

const translations: Record<Locale, Record<string, string>> = {
  en,
  es,
  zh,
  ja,
};

/**
 * Look up a translation key for the current locale.
 * Falls back to English if the key is missing in the active locale.
 * Returns the raw key if it is not found in any locale.
 */
export function t(key: string): string {
  const { locale } = useI18nStore.getState();
  return translations[locale]?.[key] ?? translations.en[key] ?? key;
}
