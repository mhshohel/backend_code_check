import { logoutAction } from './actions';

/** A plain form: works before hydration and without JavaScript. */
export function LogoutButton() {
  return (
    <form action={logoutAction}>
      <button type="submit" className="link-button">
        Sign out
      </button>
    </form>
  );
}
