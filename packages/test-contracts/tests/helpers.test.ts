import { describe, expect, it } from '@jest/globals';
import { expectTypename, sessionCookieFrom } from '../src/support/graphql-http';
import { waitFor } from '../src/support/wait-for';

describe('waitFor', () => {
  it('resolves with the first truthy probe value', async () => {
    let calls = 0;
    const value = await waitFor(() => (++calls >= 3 ? 'ready' : undefined), { intervalMs: 1 });
    expect(value).toBe('ready');
    expect(calls).toBe(3);
  });

  it('rejects after the timeout and reports the last probe error', async () => {
    const probe = () => {
      throw new Error('still down');
    };
    await expect(waitFor(probe, { timeoutMs: 30, intervalMs: 5, description: 'service' })).rejects.toThrow(
      /waiting for service: still down/,
    );
  });
});

describe('sessionCookieFrom', () => {
  it('extracts the session cookie pair from Set-Cookie headers', () => {
    const headers = ['other=1; Path=/', 'ofl_session=abc123; HttpOnly; SameSite=Lax; Path=/'];
    expect(sessionCookieFrom(headers)).toBe('ofl_session=abc123');
  });

  it('returns undefined when the session cookie is missing', () => {
    expect(sessionCookieFrom(['other=1'])).toBeUndefined();
  });
});

describe('expectTypename', () => {
  type Result = { __typename: 'Ok'; value: number } | { __typename: 'Failed'; code: string };

  it('narrows to the requested union member', () => {
    const result = { __typename: 'Ok', value: 1 } as Result;
    expect(expectTypename(result, 'Ok').value).toBe(1);
  });

  it('throws with the actual member otherwise', () => {
    const result = { __typename: 'Failed', code: 'X' } as Result;
    expect(() => expectTypename(result, 'Ok')).toThrow(/expected Ok, got Failed/);
  });
});
