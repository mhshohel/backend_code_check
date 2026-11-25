import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

export type ToastTone = 'info' | 'success' | 'error';
export type Toast = { readonly id: string; readonly tone: ToastTone; readonly message: string };
export type ToastState = { readonly items: readonly Toast[] };

const MAX_TOASTS = 4;

export const toastSlice = createSlice({
  name: 'toasts',
  initialState: { items: [] } as ToastState,
  reducers: {
    toastShown: {
      reducer(state, action: PayloadAction<Toast>) {
        state.items = [...state.items, action.payload].slice(-MAX_TOASTS);
      },
      prepare(payload: { tone: ToastTone; message: string }) {
        return { payload: { ...payload, id: crypto.randomUUID() } };
      },
    },
    toastDismissed(state, action: PayloadAction<string>) {
      state.items = state.items.filter((toast) => toast.id !== action.payload);
    },
  },
});

export const { toastShown, toastDismissed } = toastSlice.actions;
