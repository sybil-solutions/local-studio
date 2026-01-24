import { create, type StateCreator } from "zustand";
import { devtools, persist, createJSONStorage } from "zustand/middleware";
import { createChatSlice, type ChatSlice } from "./chat-slice";

export type AppStore = ChatSlice & {
  _hasHydrated: boolean;
  setHasHydrated: (hasHydrated: boolean) => void;
};

const createAppStore: StateCreator<AppStore, [], [], AppStore> = (set, ...args) => ({
  ...createChatSlice(set, ...args),
  _hasHydrated: false,
  setHasHydrated: (hasHydrated) => set({ _hasHydrated: hasHydrated }),
});

const storage = createJSONStorage(() =>
  typeof window !== "undefined" ? localStorage : undefined,
);

export const useAppStore = create<AppStore>()(
  devtools(
    persist(createAppStore, {
      name: "vllm-studio-chat-state",
      storage,
      skipHydration: true,
      partialize: (state) => ({
        selectedModel: state.selectedModel,
        systemPrompt: state.systemPrompt,
        mcpEnabled: state.mcpEnabled,
        artifactsEnabled: state.artifactsEnabled,
        deepResearch: state.deepResearch,
        sidebarCollapsed: state.sidebarCollapsed,
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    }),
    {
      name: "vllm-studio",
    },
  ),
);
