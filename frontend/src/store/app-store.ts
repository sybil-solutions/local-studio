import { create, type StateCreator } from 'zustand';
import { devtools } from 'zustand/middleware';
import { createChatSlice, type ChatSlice } from './chat-slice';

export type AppStore = ChatSlice;

const createAppStore: StateCreator<AppStore, [], [], AppStore> = (...args) => ({
  ...createChatSlice(...args),
});

export const useAppStore = create<AppStore>()(
  devtools(createAppStore, {
    name: 'vllm-studio',
  })
);
