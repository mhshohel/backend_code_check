import { useEffect } from 'react';
import { useAppDispatch, useAppSelector } from '../../app/store';
import { toastDismissed, type Toast } from './uiSlice';

const AUTO_DISMISS_MS = 6000;

/** Polite live region: toasts are announced without stealing focus. */
export function Toasts() {
  const toasts = useAppSelector((state) => state.ui.toasts);
  return (
    <div className="toasts" role="status" aria-live="polite" aria-label="Notifications">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} />
      ))}
    </div>
  );
}

function ToastItem({ toast }: { toast: Toast }) {
  const dispatch = useAppDispatch();
  useEffect(() => {
    const timer = setTimeout(() => dispatch(toastDismissed(toast.id)), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [dispatch, toast.id]);
  return (
    <div className={`toast toast-${toast.kind}`}>
      <span>{toast.message}</span>
      <button type="button" className="toast-close" onClick={() => dispatch(toastDismissed(toast.id))} aria-label="Dismiss notification">
        ×
      </button>
    </div>
  );
}
