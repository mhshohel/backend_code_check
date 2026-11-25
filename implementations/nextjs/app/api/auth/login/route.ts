import { observed } from '@/modules/server/http/observe';
import { crossOriginPreflight, withGuards } from '@/modules/server/http/guards';
import { handleLogin } from '@/modules/server/auth-handlers';

export const POST = observed('/api/auth/login', (request, meta) => withGuards(() => handleLogin(request, meta)));

export function OPTIONS(): Response {
  return crossOriginPreflight();
}
