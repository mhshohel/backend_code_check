import type { TypedDocumentNode } from '@graphql-typed-document-node/core';
import { print } from 'graphql';
import type { TargetHttp } from '../target';

export const SESSION_COOKIE = 'ofl_session';
export const CSRF_HEADERS: Readonly<Record<string, string>> = { 'x-ofl-csrf': '1' };

export type GraphQLErrorShape = {
  message: string;
  path?: ReadonlyArray<string | number>;
  extensions?: { code?: string; [key: string]: unknown };
};

export type GraphQLResponse<TData> = {
  status: number;
  data?: TData | null;
  errors?: GraphQLErrorShape[];
  extensions?: Record<string, unknown>;
};

export type HttpEndpoints = Pick<TargetHttp, 'baseUrl' | 'graphqlPath' | 'loginPath' | 'logoutPath'>;

/** Extracts `ofl_session=<value>` from Set-Cookie headers. */
export function sessionCookieFrom(setCookieHeaders: readonly string[]): string | undefined {
  for (const header of setCookieHeaders) {
    const [pair] = header.split(';');
    if (pair?.trim().startsWith(`${SESSION_COOKIE}=`)) return pair.trim();
  }
  return undefined;
}

export function sessionCookieForToken(token: string): string {
  return `${SESSION_COOKIE}=${token}`;
}

/** A GraphQL-over-HTTP client with a one-cookie jar (the session cookie). */
export class GraphQLHttpClient {
  private cookie: string | undefined;

  constructor(
    private readonly endpoints: HttpEndpoints,
    cookie?: string,
  ) {
    this.cookie = cookie;
  }

  get sessionCookie(): string | undefined {
    return this.cookie;
  }

  async login(email: string, password: string): Promise<void> {
    const response = await fetch(this.url(this.endpoints.loginPath), {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...CSRF_HEADERS },
      body: JSON.stringify({ email, password }),
    });
    if (response.status !== 200) {
      throw new Error(`login for ${email} failed with HTTP ${response.status}: ${await response.text()}`);
    }
    const cookie = sessionCookieFrom(response.headers.getSetCookie());
    if (!cookie) throw new Error(`login for ${email} did not set the ${SESSION_COOKIE} cookie`);
    this.cookie = cookie;
  }

  async logout(): Promise<number> {
    const response = await fetch(this.url(this.endpoints.logoutPath), {
      method: 'POST',
      headers: { ...CSRF_HEADERS, ...this.cookieHeader() },
    });
    this.cookie = undefined;
    return response.status;
  }

  async execute<TData, TVariables>(
    document: TypedDocumentNode<TData, TVariables>,
    variables: TVariables,
    extraHeaders: Record<string, string> = {},
  ): Promise<GraphQLResponse<TData>> {
    const response = await fetch(this.url(this.endpoints.graphqlPath), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/graphql-response+json, application/json',
        ...CSRF_HEADERS,
        ...this.cookieHeader(),
        ...extraHeaders,
      },
      body: JSON.stringify({ query: print(document), variables }),
    });
    const body = (await response.json()) as Omit<GraphQLResponse<TData>, 'status'>;
    return { status: response.status, ...body };
  }

  /** Executes and returns data, failing the test on any GraphQL error. */
  async data<TData, TVariables>(
    document: TypedDocumentNode<TData, TVariables>,
    variables: TVariables,
  ): Promise<TData> {
    const result = await this.execute(document, variables);
    if (result.errors?.length || !result.data) {
      throw new Error(`unexpected GraphQL errors: ${JSON.stringify(result.errors ?? 'no data')}`);
    }
    return result.data;
  }

  private cookieHeader(): Record<string, string> {
    return this.cookie ? { cookie: this.cookie } : {};
  }

  private url(path: string): string {
    return new URL(path, this.endpoints.baseUrl).toString();
  }
}

export function errorCodes(response: { errors?: GraphQLErrorShape[] }): string[] {
  return (response.errors ?? []).map((error) => error.extensions?.code ?? 'NO_CODE');
}

/** Narrows a result union to one member, failing with the actual typename otherwise. */
export function expectTypename<TUnion extends { __typename: string }, TName extends TUnion['__typename']>(
  value: TUnion,
  typename: TName,
): Extract<TUnion, { __typename: TName }> {
  if (value.__typename !== typename) {
    throw new Error(`expected ${typename}, got ${value.__typename}: ${JSON.stringify(value)}`);
  }
  return value as Extract<TUnion, { __typename: TName }>;
}
