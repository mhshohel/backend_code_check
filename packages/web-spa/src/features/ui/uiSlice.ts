import { createSlice, nanoid, type PayloadAction } from '@reduxjs/toolkit';

export type ToastKind = 'success' | 'error' | 'info';
export type Toast = { id: string; kind: ToastKind; message: string };
export type LiveConnection = 'idle' | 'connecting' | 'connected' | 'reconnecting';

export type UiState = {
  toasts: Toast[];
  liveConnection: LiveConnection;
};

const initialState: UiState = { toasts: [], liveConnection: 'idle' };

export const uiSlice = createSlice({
  name: 'ui',
  initialState,
  reducers: {
    toastShown: {
      reducer(state, action: PayloadAction<Toast>) {
        state.toasts = [...state.toasts.slice(-4), action.payload];
      },
      prepare(kind: ToastKind, message: string) {
        return { payload: { id: nanoid(), kind, message } };
      },
    },
    toastDismissed(state, action: PayloadAction<string>) {
      state.toasts = state.toasts.filter((toast) => toast.id !== action.payload);
    },
    liveConnectionChanged(state, action: PayloadAction<LiveConnection>) {
      state.liveConnection = action.payload;
    },
  },
});

export const { toastShown, toastDismissed, liveConnectionChanged } = uiSlice.actions;
