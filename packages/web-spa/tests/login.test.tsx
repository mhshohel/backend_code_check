import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from './test-utils';

const originalFetch = globalThis.fetch;
let fetchMock: jest.Mock<typeof fetch>;

beforeEach(() => {
  fetchMock = jest.fn<typeof fetch>();
  globalThis.fetch = fetchMock;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('login', () => {
  it('validates input before calling the server', async () => {
    const user = userEvent.setup();
    renderApp({ path: '/login' });
    await user.click(await screen.findByRole('button', { name: 'Sign in' }));
    expect(screen.getByLabelText('Email')).toHaveAccessibleDescription('Enter a valid email address.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts JSON with the CSRF header and shows a useful error', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'invalid' }), { status: 401 }));
    renderApp({ path: '/login' });
    await user.type(await screen.findByLabelText('Email'), 'customer@example.com');
    await user.type(screen.getByLabelText('Password'), 'wrong');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The email or password is incorrect.');
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('/auth/login');
    expect(init).toMatchObject({
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json', 'x-ofl-csrf': '1' },
      body: JSON.stringify({ email: 'customer@example.com', password: 'wrong' }),
    });
  });

  it('returns to the requested page after signing in', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ user: {} }), { status: 200 }));
    const app = renderApp({ path: '/login?next=%2Fcart' });
    await user.type(await screen.findByLabelText('Email'), 'customer@example.com');
    await user.type(screen.getByLabelText('Password'), 'customer-pass-1');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(app.router.state.location.pathname).toBe('/cart'));
  });

  it('never redirects to another origin', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
    const app = renderApp({ path: '/login?next=%2F%2Fevil.example' });
    await user.type(await screen.findByLabelText('Email'), 'customer@example.com');
    await user.type(screen.getByLabelText('Password'), 'customer-pass-1');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(app.router.state.location.pathname).toBe('/'));
  });
});
