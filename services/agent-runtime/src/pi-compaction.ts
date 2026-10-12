/**
 * Compaction tuning for locally served models.
 *
 * pi's default auto-compaction reserve (16,384 tokens) is sized for hosted
 * frontier APIs that serve their full window reliably. A local engine gets
 * slow — and an experimental build can die outright — well before its hard
 * limit, so a session that only compacts 16k tokens shy of a 250k window
 * spends its whole late life in the fragile zone, and the compaction
 * summarization request itself then runs at maximum depth. Scaling the
 * reserve to a fraction of the model's window makes sessions compact while
 * the engine still has comfortable headroom (250k → compact at ~200k).
 *
 * The scale applies only to local-studio provider models: hosted providers
 * keep pi's stock behavior. The override is patched onto the session's
 * SettingsManager instance — every SDK consumer (threshold checks, auto
 * compaction, our contextUsage snapshot) reads through
 * getCompactionSettings(), so one patch covers them all, and it reads the
 * session's *current* model so mid-session model switches stay correct.
 */

export const LOCAL_COMPACTION_RESERVE_FRACTION = 0.2;

interface CompactionSettings {
  enabled: boolean;
  reserveTokens: number;
  keepRecentTokens: number;
}

interface CompactionAwareSession {
  readonly model?: { provider?: string; contextWindow?: number } | undefined;
  readonly settingsManager: { getCompactionSettings: () => CompactionSettings };
}

export function scaleCompactionForLocalModels(session: CompactionAwareSession): void {
  const manager = session.settingsManager;
  const base = manager.getCompactionSettings.bind(manager);
  manager.getCompactionSettings = (): CompactionSettings => {
    const settings = base();
    const model = session.model;
    const window = model?.contextWindow ?? 0;
    if (model?.provider !== "local-studio" || window <= 0) return settings;
    const scaled = Math.ceil(window * LOCAL_COMPACTION_RESERVE_FRACTION);
    return scaled > settings.reserveTokens ? { ...settings, reserveTokens: scaled } : settings;
  };
}
