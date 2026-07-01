/** Stable no-op snapshot for `useSyncExternalStore`-based "run once" hooks
 * across the chat-pane hook family — they only need a subscription's mount
 * effect, not real store state. */
export const getChatPaneSnapshot = (): number => 0;
