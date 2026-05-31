import type { SettingsState } from './store.js';

const DEFAULT_SETTINGS: SettingsState = {
  theme: 'light',
  autosave: true,
};

export function loadSettings(raw: string | null): SettingsState {
  if (!raw) {
    return DEFAULT_SETTINGS;
  }
  try {
    return JSON.parse(raw) as SettingsState;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

