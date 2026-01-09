'use client';

import { useState, useEffect } from 'react';
import { Moon, Sun, Monitor } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

type Theme = 'light' | 'dark' | 'system';

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('dark');
  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>('dark');
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    // Load saved theme preference
    const saved = localStorage.getItem('theme') as Theme | null;
    if (saved) {
      setTheme(saved);
    }

    // Determine initial resolved theme
    const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    const initialTheme = saved === 'system' ? systemTheme : (saved || systemTheme);
    setResolvedTheme(initialTheme);
    applyTheme(initialTheme);
  }, []);

  useEffect(() => {
    // Listen for system theme changes
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (e: MediaQueryListEvent) => {
      if (theme === 'system') {
        const newTheme = e.matches ? 'dark' : 'light';
        setResolvedTheme(newTheme);
        applyTheme(newTheme);
      }
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [theme]);

  const applyTheme = (newTheme: 'light' | 'dark') => {
    const root = document.documentElement;

    if (newTheme === 'dark') {
      root.style.setProperty('--background', '#1a1a1a');
      root.style.setProperty('--foreground', '#ededed');
      root.style.setProperty('--card', '#242424');
      root.style.setProperty('--card-foreground', '#ededed');
      root.style.setProperty('--popover', '#242424');
      root.style.setProperty('--popover-foreground', '#ededed');
      root.style.setProperty('--primary', '#f3f4f6');
      root.style.setProperty('--primary-foreground', '#1a1a1a');
      root.style.setProperty('--secondary', '#2a2a2a');
      root.style.setProperty('--secondary-foreground', '#ededed');
      root.style.setProperty('--muted', '#2a2a2a');
      root.style.setProperty('--muted-foreground', '#d4d4d4');
      root.style.setProperty('--accent', '#2a2a2a');
      root.style.setProperty('--accent-foreground', '#f3f4f6');
      root.style.setProperty('--destructive', '#7f1d1d');
      root.style.setProperty('--destructive-foreground', '#f3f4f6');
      root.style.setProperty('--border', '#2a2a2a');
      root.style.setProperty('--input', '#2a2a2a');
      root.style.setProperty('--ring', '#52525b');
      root.style.setProperty('--success', '#22c55e');
      root.style.setProperty('--warning', '#eab308');
    } else {
      root.style.setProperty('--background', '#ffffff');
      root.style.setProperty('--foreground', '#171717');
      root.style.setProperty('--card', '#f5f5f5');
      root.style.setProperty('--card-foreground', '#171717');
      root.style.setProperty('--popover', '#ffffff');
      root.style.setProperty('--popover-foreground', '#171717');
      root.style.setProperty('--primary', '#171717');
      root.style.setProperty('--primary-foreground', '#fafafa');
      root.style.setProperty('--secondary', '#e5e5e5');
      root.style.setProperty('--secondary-foreground', '#171717');
      root.style.setProperty('--muted', '#f5f5f5');
      root.style.setProperty('--muted-foreground', '#737373');
      root.style.setProperty('--accent', '#f5f5f5');
      root.style.setProperty('--accent-foreground', '#171717');
      root.style.setProperty('--destructive', '#dc2626');
      root.style.setProperty('--destructive-foreground', '#fafafa');
      root.style.setProperty('--border', '#e5e5e5');
      root.style.setProperty('--input', '#e5e5e5');
      root.style.setProperty('--ring', '#d4d4d8');
      root.style.setProperty('--success', '#16a34a');
      root.style.setProperty('--warning', '#ca8a04');
    }
  };

  const changeTheme = (newTheme: Theme) => {
    setTheme(newTheme);
    localStorage.setItem('theme', newTheme);
    setIsOpen(false);

    const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    const newResolvedTheme = newTheme === 'system' ? systemTheme : newTheme;
    setResolvedTheme(newResolvedTheme);
    applyTheme(newResolvedTheme);
  };

  const themes: { value: Theme; icon: typeof Sun; label: string }[] = [
    { value: 'light', icon: Sun, label: 'Light' },
    { value: 'dark', icon: Moon, label: 'Dark' },
    { value: 'system', icon: Monitor, label: 'System' },
  ];

  const CurrentIcon = theme === 'light' ? Sun : theme === 'dark' ? Moon : Monitor;

  return (
    <div className="relative">
      <motion.button
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={() => setIsOpen(!isOpen)}
        className="p-2 rounded-lg hover:bg-[var(--accent)] transition-colors text-[#b0a8a0] hover:text-[var(--foreground)]"
        title="Toggle theme"
      >
        <motion.div
          key={resolvedTheme}
          initial={{ rotate: -180, opacity: 0 }}
          animate={{ rotate: 0, opacity: 1 }}
          exit={{ rotate: 180, opacity: 0 }}
          transition={{ duration: 0.3, type: 'spring', stiffness: 200, damping: 20 }}
        >
          <CurrentIcon className="h-5 w-5" />
        </motion.div>
      </motion.button>

      <AnimatePresence>
        {isOpen && (
          <>
            {/* Backdrop */}
            <div
              className="fixed inset-0 z-40"
              onClick={() => setIsOpen(false)}
            />

            {/* Menu */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: -10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: -10 }}
              transition={{ duration: 0.15 }}
              className="absolute right-0 top-full mt-2 w-40 bg-[var(--card)] border border-[var(--border)] rounded-xl shadow-xl z-50 overflow-hidden"
            >
              <div className="p-1.5">
                {themes.map(({ value, icon: Icon, label }) => (
                  <motion.button
                    key={value}
                    whileHover={{ backgroundColor: 'var(--accent)' }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => changeTheme(value)}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                      theme === value
                        ? 'bg-[var(--accent)] text-[var(--primary)]'
                        : 'text-[#b0a8a0] hover:text-[var(--foreground)]'
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    <span>{label}</span>
                    {theme === value && (
                      <motion.div
                        layoutId="activeTheme"
                        className="ml-auto w-1.5 h-1.5 rounded-full bg-[var(--primary)]"
                        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                      />
                    )}
                  </motion.button>
                ))}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
