import { observed } from '@/modules/server/http/observe';
import { crossOriginPreflight, withGuards } from '@/modules/server/http/guards';
import { handleLogout } from '@/modules/server/auth-handlers';

export const POST = observed('/api/auth/logout', (request) => withGuards(() => handleLogout(request)));

export function OPTIONS(): Response {
  return crossOriginPreflight();
}
