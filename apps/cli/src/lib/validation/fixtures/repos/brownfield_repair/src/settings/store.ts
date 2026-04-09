export interface SettingsState {
  theme: 'light' | 'dark';
  autosave: boolean;
}

export function persistSettings(state: SettingsState): string {
  return JSON.stringify(state);
}

