import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type ThemeChoice = 'system' | 'light' | 'dark';
export type MotionChoice = 'system' | 'reduced';

const THEME_KEY = 'gm-theme';
const MOTION_KEY = 'gm-motion';
const THEMES: ThemeChoice[] = ['system', 'light', 'dark'];
const MOTIONS: MotionChoice[] = ['system', 'reduced'];

function readChoice<T extends string>(key: string, allowed: T[], fallback: T): T {
  try {
    const value = window.localStorage.getItem(key);
    return allowed.includes(value as T) ? (value as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeChoice(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* private mode: the choice lasts for this tab only */
  }
}

interface ThemeValue {
  theme: ThemeChoice;
  setTheme: (value: ThemeChoice) => void;
  resolved: 'light' | 'dark';
  motion: MotionChoice;
  setMotion: (value: MotionChoice) => void;
}

const ThemeContext = createContext<ThemeValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<ThemeChoice>(() => readChoice(THEME_KEY, THEMES, 'system'));
  const [motion, setMotion] = useState<MotionChoice>(() => readChoice(MOTION_KEY, MOTIONS, 'system'));
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false,
  );

  useEffect(() => {
    const query = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!query) return;
    const onChange = () => setSystemDark(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  const resolved: 'light' | 'dark' = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = resolved;
    root.style.colorScheme = resolved;
    const meta = document.querySelector('meta[name="theme-color"]');
    meta?.setAttribute('content', resolved === 'dark' ? '#14120f' : '#f5f0e6');
    writeChoice(THEME_KEY, theme);
  }, [resolved, theme]);

  useEffect(() => {
    document.documentElement.dataset.motion = motion === 'reduced' ? 'reduced' : 'full';
    writeChoice(MOTION_KEY, motion);
  }, [motion]);

  const value = useMemo(
    () => ({ theme, setTheme, resolved, motion, setMotion }),
    [theme, resolved, motion],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme must be used inside ThemeProvider');
  return value;
}
