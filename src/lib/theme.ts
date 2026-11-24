export type ThemeId =
  | 'black-gold'
  | 'dark-midnight'
  | 'ocean-blue'
  | 'emerald-green'
  | 'royal-purple'
  | 'light';

export interface ThemeDefinition {
  id: ThemeId;
  name: string;
  tagline: string;
  isLight: boolean;
  themeColor: string;
  chartGridColor: string;
  chartAxisColor: string;
  accentHex: string;
  accentSoftHex: string;
  swatches: {
    canvas: string;
    surface: string;
    accent: string;
    accentSoft: string;
    text: string;
    muted: string;
    border: string;
  };
}

export interface ThemePreference {
  themeId: ThemeId;
  followSystem: boolean;
}

export const THEME_STORAGE_KEY = 'hf_theme_preference_v1';
export const DEFAULT_THEME_ID: ThemeId = 'black-gold';

export const THEMES: ThemeDefinition[] = [
  {
    id: 'black-gold',
    name: 'Premium Black & Gold',
    tagline: 'Signature obsidian dark with warm gold accents',
    isLight: false,
    themeColor: '#050505',
    chartGridColor: 'rgba(255,255,255,0.06)',
    chartAxisColor: '#A5A5AD',
    accentHex: '#F5C542',
    accentSoftHex: '#F8D162',
    swatches: {
      canvas: '#050505',
      surface: '#151519',
      accent: '#F5C542',
      accentSoft: '#F8D162',
      text: '#FFFFFF',
      muted: '#A5A5AD',
      border: 'rgba(255,255,255,0.12)',
    },
  },
  {
    id: 'dark-midnight',
    name: 'Dark Midnight',
    tagline: 'Deep twilight slate with refined sky-blue accents',
    isLight: false,
    themeColor: '#060A13',
    chartGridColor: 'rgba(148,163,184,0.1)',
    chartAxisColor: '#94A3B8',
    accentHex: '#38BDF8',
    accentSoftHex: '#7DD3FC',
    swatches: {
      canvas: '#060A13',
      surface: '#111A2E',
      accent: '#38BDF8',
      accentSoft: '#7DD3FC',
      text: '#F8FAFC',
      muted: '#94A3B8',
      border: 'rgba(148,163,184,0.16)',
    },
  },
  {
    id: 'ocean-blue',
    name: 'Ocean Blue',
    tagline: 'Deep marine blue canvas with crisp cyan highlights',
    isLight: false,
    themeColor: '#04121C',
    chartGridColor: 'rgba(143,184,208,0.12)',
    chartAxisColor: '#8FB8D0',
    accentHex: '#22D3EE',
    accentSoftHex: '#67E8F9',
    swatches: {
      canvas: '#04121C',
      surface: '#0D273B',
      accent: '#22D3EE',
      accentSoft: '#67E8F9',
      text: '#F0F9FF',
      muted: '#8FB8D0',
      border: 'rgba(103,232,249,0.16)',
    },
  },
  {
    id: 'emerald-green',
    name: 'Emerald Green',
    tagline: 'Forest obsidian dark with luminous emerald accents',
    isLight: false,
    themeColor: '#04110B',
    chartGridColor: 'rgba(148,184,168,0.12)',
    chartAxisColor: '#94B8A8',
    accentHex: '#34D399',
    accentSoftHex: '#6EE7B7',
    swatches: {
      canvas: '#04110B',
      surface: '#0E281C',
      accent: '#34D399',
      accentSoft: '#6EE7B7',
      text: '#ECFDF5',
      muted: '#94B8A8',
      border: 'rgba(110,231,183,0.16)',
    },
  },
  {
    id: 'royal-purple',
    name: 'Royal Purple',
    tagline: 'Deep velvet plum with refined amethyst accents',
    isLight: false,
    themeColor: '#0B0714',
    chartGridColor: 'rgba(180,165,202,0.12)',
    chartAxisColor: '#B4A5CA',
    accentHex: '#C084FC',
    accentSoftHex: '#D8B4FE',
    swatches: {
      canvas: '#0B0714',
      surface: '#1A1130',
      accent: '#C084FC',
      accentSoft: '#D8B4FE',
      text: '#FAF5FF',
      muted: '#B4A5CA',
      border: 'rgba(216,180,254,0.16)',
    },
  },
  {
    id: 'light',
    name: 'Light Mode',
    tagline: 'Clean bright daylight canvas with rich amber-gold',
    isLight: true,
    themeColor: '#F4F5F7',
    chartGridColor: 'rgba(17,24,39,0.08)',
    chartAxisColor: '#4B5563',
    accentHex: '#B47B00',
    accentSoftHex: '#D49B1A',
    swatches: {
      canvas: '#F4F5F7',
      surface: '#FFFFFF',
      accent: '#B47B00',
      accentSoft: '#D49B1A',
      text: '#111827',
      muted: '#525866',
      border: 'rgba(17,24,39,0.12)',
    },
  },
];

const THEME_MAP: Record<ThemeId, ThemeDefinition> = THEMES.reduce(
  (acc, item) => {
    acc[item.id] = item;
    return acc;
  },
  {} as Record<ThemeId, ThemeDefinition>
);

export function isValidThemeId(value: unknown): value is ThemeId {
  return typeof value === 'string' && value in THEME_MAP;
}

export function getThemeDefinition(id: ThemeId): ThemeDefinition {
  return THEME_MAP[id] || THEME_MAP[DEFAULT_THEME_ID];
}

export function readStoredThemePreference(): ThemePreference {
  const fallback: ThemePreference = { themeId: DEFAULT_THEME_ID, followSystem: false };
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<ThemePreference>;
    return {
      themeId: isValidThemeId(parsed.themeId) ? parsed.themeId : DEFAULT_THEME_ID,
      followSystem: Boolean(parsed.followSystem),
    };
  } catch {
    return fallback;
  }
}

export function saveThemePreference(pref: ThemePreference): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(pref));
  } catch {
    // Ignore storage quota or private-mode restrictions
  }
}

export function getSystemPrefersLight(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(prefers-color-scheme: light)').matches;
}

export function resolveEffectiveThemeId(pref: ThemePreference): ThemeId {
  if (!pref.followSystem) return pref.themeId;
  const prefersLight = getSystemPrefersLight();
  if (prefersLight) return 'light';
  return pref.themeId === 'light' ? DEFAULT_THEME_ID : pref.themeId;
}

export function applyThemeToDocument(themeId: ThemeId): void {
  if (typeof document === 'undefined') return;
  const def = getThemeDefinition(themeId);
  const root = document.documentElement;
  root.dataset.theme = def.id;
  root.classList.toggle('dark', !def.isLight);
  root.classList.toggle('light', def.isLight);
  root.style.colorScheme = def.isLight ? 'light' : 'dark';

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute('content', def.themeColor);
  }
}
