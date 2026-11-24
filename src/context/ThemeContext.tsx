import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  applyThemeToDocument,
  DEFAULT_THEME_ID,
  getThemeDefinition,
  readStoredThemePreference,
  resolveEffectiveThemeId,
  saveThemePreference,
  ThemeDefinition,
  ThemeId,
  ThemePreference,
} from '../lib/theme';

interface ThemeContextValue {
  themeId: ThemeId;
  activeThemeId: ThemeId;
  activeTheme: ThemeDefinition;
  followSystem: boolean;
  setTheme: (id: ThemeId) => void;
  setFollowSystem: (enabled: boolean) => void;
  resetToDefault: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [preference, setPreference] = useState<ThemePreference>(() => readStoredThemePreference());
  const [activeThemeId, setActiveThemeId] = useState<ThemeId>(() =>
    resolveEffectiveThemeId(readStoredThemePreference())
  );

  // Sync effective theme immediately whenever preference changes
  useEffect(() => {
    const resolved = resolveEffectiveThemeId(preference);
    setActiveThemeId(resolved);
    applyThemeToDocument(resolved);
    saveThemePreference(preference);
  }, [preference]);

  // Listen for live Android/OS color-scheme updates when Follow Device Theme is enabled
  useEffect(() => {
    if (!preference.followSystem || typeof window === 'undefined' || !window.matchMedia) {
      return;
    }
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const handleChange = () => {
      const resolved = resolveEffectiveThemeId(preference);
      setActiveThemeId(resolved);
      applyThemeToDocument(resolved);
    };
    mq.addEventListener('change', handleChange);
    return () => mq.removeEventListener('change', handleChange);
  }, [preference]);

  const setTheme = useCallback((id: ThemeId) => {
    setPreference({ themeId: id, followSystem: false });
  }, []);

  const setFollowSystem = useCallback((enabled: boolean) => {
    setPreference((prev) => ({ ...prev, followSystem: enabled }));
  }, []);

  const resetToDefault = useCallback(() => {
    setPreference({ themeId: DEFAULT_THEME_ID, followSystem: false });
  }, []);

  const activeTheme = useMemo(() => getThemeDefinition(activeThemeId), [activeThemeId]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      themeId: preference.themeId,
      activeThemeId,
      activeTheme,
      followSystem: preference.followSystem,
      setTheme,
      setFollowSystem,
      resetToDefault,
    }),
    [preference, activeThemeId, activeTheme, setTheme, setFollowSystem, resetToDefault]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return ctx;
}
