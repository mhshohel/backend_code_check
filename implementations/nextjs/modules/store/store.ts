import { combineReducers, configureStore } from '@reduxjs/toolkit';
import { cartSlice } from '../cart/cart-slice';
import { checkoutSlice } from '../checkout/checkout-slice';
import { toastSlice } from '../ui/toast-slice';

const rootReducer = combineReducers({
  cart: cartSlice.reducer,
  checkout: checkoutSlice.reducer,
  toasts: toastSlice.reducer,
});

export type RootState = ReturnType<typeof rootReducer>;

/** One store per browser tab (created inside a client component), never a module singleton shared across requests. */
export function makeStore(preloadedState?: Partial<RootState>) {
  return configureStore({ reducer: rootReducer, preloadedState });
}

export type AppStore = ReturnType<typeof makeStore>;
export type AppDispatch = AppStore['dispatch'];
