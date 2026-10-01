import AsyncStorage from '@react-native-async-storage/async-storage';
import {AppConfig} from '../types';

const CONFIG_KEY = '@CakePricingApp:config';

export const DEFAULT_CONFIG: AppConfig = {
  gemini_api_key: '',
  supabase: {
    url: '',
    anon_key: '',
    business_id: '',
    auto_save_quotes: true,
  },
  // No local defaults — flavors and elements come from Supabase only
  flavors: [],
  design_elements: [],
};

export async function loadConfig(): Promise<AppConfig> {
  try {
    const json = await AsyncStorage.getItem(CONFIG_KEY);
    if (json) {
      const parsed = JSON.parse(json);
      return {
        ...DEFAULT_CONFIG,
        ...parsed,
        supabase: {
          ...DEFAULT_CONFIG.supabase,
          ...(parsed.supabase || {}),
        },
        // Always restore whatever was last synced from DB
        flavors: Array.isArray(parsed.flavors) ? parsed.flavors : [],
        design_elements: Array.isArray(parsed.design_elements) ? parsed.design_elements : [],
      };
    }
  } catch (e) {
    console.warn('Failed to load config:', e);
  }
  return DEFAULT_CONFIG;
}

export async function saveConfig(config: AppConfig): Promise<void> {
  try {
    await AsyncStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  } catch (e) {
    console.warn('Failed to save config:', e);
  }
}
