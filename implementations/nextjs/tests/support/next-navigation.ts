// Test double for next/navigation: records navigations instead of routing.
export type RouterCall = { method: 'push' | 'replace' | 'refresh' | 'back' | 'prefetch'; href?: string };

export const routerCalls: RouterCall[] = [];

const router = {
  push: (href: string) => {
    routerCalls.push({ method: 'push', href });
  },
  replace: (href: string) => {
    routerCalls.push({ method: 'replace', href });
  },
  refresh: () => {
    routerCalls.push({ method: 'refresh' });
  },
  back: () => {
    routerCalls.push({ method: 'back' });
  },
  forward: () => undefined,
  prefetch: (href: string) => {
    routerCalls.push({ method: 'prefetch', href });
  },
};

export function useRouter(): typeof router {
  return router;
}

export function usePathname(): string {
  return '/';
}

export function useSearchParams(): URLSearchParams {
  return new URLSearchParams();
}

export function resetRouterMock(): void {
  routerCalls.length = 0;
}

export function notFound(): never {
  throw new Error('notFound() called');
}

export function redirect(href: string): never {
  throw new Error(`redirect(${href}) called`);
}

export function forbidden(): never {
  throw new Error('forbidden() called');
}
