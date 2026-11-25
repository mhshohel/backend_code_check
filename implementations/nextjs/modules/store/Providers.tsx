'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { Provider as ReduxProvider } from 'react-redux';
import { Provider as UrqlProvider, type Client } from 'urql';
import { createUrqlClient } from '../graphql/client';
import { createRealtimeStatusStore, type RealtimeStatusStore } from '../realtime/connection-status';
import { RealtimeStatusContext } from '../realtime/use-realtime-status';
import { hydrateCart, parseStoredCart } from '../cart/cart-slice';
import { makeStore, type AppStore } from './store';
import { Toasts } from '../ui/Toasts';

const CART_STORAGE_KEY = 'ofl.cart.v1';

type Props = { readonly realtimeUrl: string | null; readonly children: ReactNode };

type ClientState = { store: AppStore; urql: Client; realtimeStatus: RealtimeStatusStore };

function createClientState(realtimeUrl: string | null): ClientState {
  const realtimeStatus = createRealtimeStatusStore();
  return { store: makeStore(), urql: createUrqlClient({ realtimeUrl, realtimeStatus }), realtimeStatus };
}

/** Restores the cart from localStorage once, then saves it on every change. Storage failures are ignored. */
function useCartPersistence(store: AppStore): void {
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(CART_STORAGE_KEY);
      const cart = stored ? parseStoredCart(JSON.parse(stored)) : null;
      if (cart) store.dispatch(hydrateCart(cart));
    } catch {
      // Private mode or corrupt data: start with an empty cart.
    }
    let previous = store.getState().cart;
    return store.subscribe(() => {
      const current = store.getState().cart;
      if (current === previous) return;
      previous = current;
      try {
        window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(current));
      } catch {
        // Quota exceeded or storage blocked: the cart still works for this tab.
      }
    });
  }, [store]);
}

export function Providers({ realtimeUrl, children }: Props) {
  // useState keeps one store and one client per mounted app (per tab), never shared between requests.
  const [state] = useState(() => createClientState(realtimeUrl));
  useCartPersistence(state.store);

  return (
    <ReduxProvider store={state.store}>
      <UrqlProvider value={state.urql}>
        <RealtimeStatusContext.Provider value={state.realtimeStatus}>
          {children}
          <Toasts />
        </RealtimeStatusContext.Provider>
      </UrqlProvider>
    </ReduxProvider>
  );
}
