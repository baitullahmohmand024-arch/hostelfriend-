import { Check, MonitorSmartphone, Palette, RotateCcw, Sun, Moon } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import { useToast } from '../context/ToastContext';
import { DEFAULT_THEME_ID, getSystemPrefersLight, THEMES, ThemeId } from '../lib/theme';
import { playSound } from '../utils/soundVfx';

export function ThemeCustomizationCard() {
  const {
    themeId,
    activeThemeId,
    activeTheme,
    followSystem,
    setTheme,
    setFollowSystem,
    resetToDefault,
  } = useTheme();
  const { showToast } = useToast();

  const systemIsLight = getSystemPrefersLight();
  const isDefault = themeId === DEFAULT_THEME_ID && !followSystem;

  const handleSelectTheme = (id: ThemeId, name: string) => {
    setTheme(id);
    playSound('ui-tap');
    showToast({
      type: 'success',
      title: `${name} applied`,
      description: 'Saved for future visits on this device.',
    });
  };

  const handleToggleFollowSystem = (enabled: boolean) => {
    setFollowSystem(enabled);
    playSound('ui-tap');
    showToast({
      type: 'info',
      title: enabled ? 'Following device theme' : 'Manual theme selected',
      description: enabled
        ? `Matched your device's ${systemIsLight ? 'Light' : 'Dark'} appearance.`
        : `Using ${activeTheme.name}.`,
    });
  };

  const handleReset = () => {
    resetToDefault();
    playSound('ui-tap');
    showToast({
      type: 'info',
      title: 'Reset to Premium Black & Gold',
    });
  };

  return (
    <section
      id="theme-customization"
      aria-labelledby="theme-customization-heading"
      className="glass-card rounded-2xl p-5 sm:p-6 space-y-5"
    >
      {/* Header + Reset */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-hairline">
        <div className="flex items-start sm:items-center gap-2.5">
          <Palette className="w-4 h-4 text-accent shrink-0 mt-0.5 sm:mt-0" />
          <div>
            <h2
              id="theme-customization-heading"
              className="font-display text-base font-semibold text-ink-2"
            >
              Appearance &amp; Themes
            </h2>
            <p className="text-xs text-ink-muted">
              Instant app-wide color theme with live preview and automatic saving
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={handleReset}
          disabled={isDefault}
          className="self-start sm:self-auto min-h-[38px] px-3 py-1.5 rounded-xl text-xs font-medium border border-hairline-strong text-ink-2 hover:border-accent/50 hover:bg-hover-tint inline-flex items-center gap-1.5 transition-colors disabled:opacity-40 disabled:pointer-events-none"
        >
          <RotateCcw className="w-3.5 h-3.5 text-accent" />
          <span>Reset to Default</span>
        </button>
      </div>

      {/* Live Preview Banner */}
      <div className="rounded-xl bg-canvas-alt border border-hairline p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div
            className="w-11 h-11 rounded-xl border border-hairline-strong flex items-center justify-center shrink-0"
            style={{ backgroundColor: activeTheme.swatches.surface }}
          >
            {activeTheme.isLight ? (
              <Sun className="w-5 h-5" style={{ color: activeTheme.swatches.accent }} />
            ) : (
              <Moon className="w-5 h-5" style={{ color: activeTheme.swatches.accent }} />
            )}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-sm font-semibold text-ink truncate">{activeTheme.name}</p>
              <span className="text-[11px] font-mono text-accent">
                {followSystem ? 'Active (Device Sync)' : 'Active'}
              </span>
            </div>
            <p className="text-xs text-ink-muted mt-0.5 truncate">{activeTheme.tagline}</p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span className="px-3 py-1.5 rounded-lg bg-surface border border-hairline text-[11px] font-medium text-ink-2">
            Card Sample
          </span>
          <span className="gold-gradient-btn px-3 py-1.5 rounded-lg text-[11px] font-bold">
            Primary CTA
          </span>
        </div>
      </div>

      {/* Optional Follow Device Theme Toggle */}
      <div className="rounded-xl bg-canvas-alt border border-hairline p-4 flex items-center justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          <MonitorSmartphone className="w-4 h-4 text-accent shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-ink-2">Follow Device Theme</p>
            <p className="text-xs text-ink-muted mt-0.5 leading-relaxed">
              Automatically switch between Light Mode and your preferred dark theme based on your
              device setting (currently {systemIsLight ? 'Light' : 'Dark'}).
            </p>
          </div>
        </div>

        <label className="inline-flex items-center gap-2 shrink-0 cursor-pointer">
          <span className="text-xs text-ink-muted font-medium">
            {followSystem ? 'Auto' : 'Manual'}
          </span>
          <input
            type="checkbox"
            aria-label="Follow Device Theme"
            checked={followSystem}
            onChange={(e) => handleToggleFollowSystem(e.target.checked)}
            className="w-4 h-4 accent-[var(--hf-accent)] cursor-pointer"
          />
        </label>
      </div>

      {/* 6 Theme Selection Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
        {THEMES.map((item) => {
          const isSelected = activeThemeId === item.id;
          const isManualChoice = !followSystem && themeId === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => handleSelectTheme(item.id, item.name)}
              aria-pressed={isSelected}
              className={`group text-left rounded-2xl p-3.5 border hf-press focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                isSelected
                  ? 'glass-card border-accent ring-1 ring-accent/40'
                  : 'bg-canvas-alt/80 border-hairline hover:border-hairline-strong hover:bg-surface'
              }`}
            >
              {/* Mini UI Card Preview rendered in the candidate theme's actual palette */}
              <div
                className="rounded-xl p-2.5 border mb-3 space-y-2 transition-transform duration-150 group-hover:scale-[1.01]"
                style={{
                  backgroundColor: item.swatches.canvas,
                  borderColor: item.swatches.border,
                }}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <span
                      className="w-3.5 h-3.5 rounded-full inline-block"
                      style={{ backgroundColor: item.swatches.accent }}
                    />
                    <span
                      className="h-2 w-12 rounded-full inline-block"
                      style={{ backgroundColor: item.swatches.text, opacity: 0.85 }}
                    />
                  </div>
                  <span
                    className="h-2 w-6 rounded-full inline-block"
                    style={{ backgroundColor: item.swatches.accent, opacity: 0.9 }}
                  />
                </div>

                <div
                  className="rounded-lg p-2 border space-y-1.5"
                  style={{
                    backgroundColor: item.swatches.surface,
                    borderColor: item.swatches.border,
                  }}
                >
                  <div
                    className="h-2 w-4/5 rounded-full"
                    style={{ backgroundColor: item.swatches.text, opacity: 0.78 }}
                  />
                  <div
                    className="h-1.5 w-3/5 rounded-full"
                    style={{ backgroundColor: item.swatches.muted, opacity: 0.7 }}
                  />
                  <div className="pt-1 flex items-center justify-between">
                    <span
                      className="h-2.5 w-10 rounded"
                      style={{ backgroundColor: item.swatches.accentSoft, opacity: 0.35 }}
                    />
                    <span
                      className="h-3.5 w-11 rounded-md"
                      style={{ backgroundColor: item.swatches.accent }}
                    />
                  </div>
                </div>
              </div>

              {/* Theme Label & Swatches */}
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-display text-sm font-semibold text-ink truncate">
                    {item.name}
                  </p>
                  <p className="text-[11px] text-ink-muted mt-0.5 line-clamp-2 leading-snug">
                    {item.tagline}
                  </p>
                </div>

                <span
                  aria-hidden="true"
                  className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 border transition-colors ${
                    isSelected
                      ? 'bg-accent border-accent text-accent-fg'
                      : 'border-hairline-strong bg-transparent text-transparent'
                  }`}
                >
                  <Check className="w-3.5 h-3.5 stroke-[2.6]" />
                </span>
              </div>

              <div className="mt-3 pt-2.5 border-t border-hairline flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5" aria-label={`${item.name} color swatches`}>
                  {[
                    item.swatches.canvas,
                    item.swatches.surface,
                    item.swatches.accent,
                    item.swatches.text,
                  ].map((hex, idx) => (
                    <span
                      key={idx}
                      className="w-3.5 h-3.5 rounded-full border border-hairline-strong"
                      style={{ backgroundColor: hex }}
                    />
                  ))}
                </div>

                <span className="text-[11px] font-medium text-accent">
                  {isSelected
                    ? isManualChoice
                      ? 'Selected'
                      : 'Active'
                    : 'Select'}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
