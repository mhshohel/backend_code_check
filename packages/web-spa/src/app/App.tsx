import { RouterProvider, type DataRouter } from 'react-router';
import { AppProviders, type AppProvidersProps } from './AppProviders';

export type AppProps = Omit<AppProvidersProps, 'children'> & { router: DataRouter };

/** The whole SPA for a given router (browser router in production, memory router in tests). */
export function App({ router, ...providers }: AppProps) {
  return (
    <AppProviders {...providers}>
      <RouterProvider router={router} />
    </AppProviders>
  );
}
