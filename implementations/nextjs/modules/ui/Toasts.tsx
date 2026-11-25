'use client';

import { useEffect } from 'react';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { toastDismissed, type Toast } from './toast-slice';

const AUTO_DISMISS_MS = 6_000;

function ToastItem({ toast }: { readonly toast: Toast }) {
  const dispatch = useAppDispatch();
  useEffect(() => {
    // Errors stay until dismissed so screen-reader and slow readers do not miss them.
    if (toast.tone === 'error') return undefined;
    const timer = setTimeout(() => dispatch(toastDismissed(toast.id)), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [dispatch, toast.id, toast.tone]);

  return (
    <li className={`toast toast-${toast.tone}`}>
      <span>{toast.message}</span>
      <button type="button" className="link-button" onClick={() => dispatch(toastDismissed(toast.id))}>
        Dismiss<span className="visually-hidden"> notification</span>
      </button>
    </li>
  );
}

export function Toasts() {
  const toasts = useAppSelector((state) => state.toasts.items);
  return (
    <div className="toast-region" role="status" aria-live="polite" aria-relevant="additions">
      <ul>
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} />
        ))}
      </ul>
    </div>
  );
}
