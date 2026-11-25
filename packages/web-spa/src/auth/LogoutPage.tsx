import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { ErrorAlert, PageHeader, Spinner } from '../components';
import { useAppDispatch } from '../app/store';
import { attemptFinished } from '../features/checkout/checkoutSlice';
import { useSession } from './session';

export function LogoutPage() {
  const { signOut } = useSession();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const [failed, setFailed] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void signOut().then((ok) => {
      if (!ok) {
        setFailed(true);
        return;
      }
      dispatch(attemptFinished());
      navigate('/', { replace: true });
    });
  }, [signOut, dispatch, navigate]);

  return (
    <div className="narrow">
      <PageHeader title="Sign out" />
      {failed ? (
        <ErrorAlert>
          Sign-out failed. <Link to="/logout" reloadDocument>Try again</Link>.
        </ErrorAlert>
      ) : (
        <Spinner label="Signing out…" />
      )}
    </div>
  );
}
