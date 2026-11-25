import { combineReducers, configureStore } from '@reduxjs/toolkit';
import { useDispatch, useSelector, useStore } from 'react-redux';
import { cartSlice } from '../features/cart/cartSlice';
import { checkoutSlice } from '../features/checkout/checkoutSlice';
import { uiSlice } from '../features/ui/uiSlice';
import { loadPersistedState, savePersistedState, type KeyValueStorage } from './persistence';

const rootReducer = combineReducers({
  cart: cartSlice.reducer,
  checkout: checkoutSlice.reducer,
  ui: uiSlice.reducer,
});

export type RootState = ReturnType<typeof rootReducer>;

/**
 * Redux holds shared client state only: cart, checkout attempt, toasts and
 * connection status. Server data stays in the urql cache.
 */
export function createAppStore(options: { storage?: KeyValueStorage } = {}) {
  const persisted = loadPersistedState(options.storage);
  const store = configureStore({ reducer: rootReducer, preloadedState: persisted });

  let previous: Pick<RootState, 'cart' | 'checkout'> | null = null;
  store.subscribe(() => {
    const { cart, checkout } = store.getState();
    if (previous?.cart === cart && previous.checkout === checkout) return;
    previous = { cart, checkout };
    savePersistedState(options.storage, { cart, checkout });
  });
  return store;
}

export type AppStore = ReturnType<typeof createAppStore>;
export type AppDispatch = AppStore['dispatch'];

export const useAppDispatch = useDispatch.withTypes<AppDispatch>();
export const useAppSelector = useSelector.withTypes<RootState>();
export const useAppStore = useStore.withTypes<AppStore>();
