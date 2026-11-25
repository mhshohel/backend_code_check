import { signWebhookBody } from '@ofl/server-core';

export type PaymentNotificationBody = {
  providerEventId: string;
  paymentId: string;
  kind: 'PAYMENT_SUCCEEDED' | 'PAYMENT_DECLINED';
  amountMinor: number;
};

export type WebhookResponse = { status: number; body: { status?: string; error?: string } };

const SIGNATURE_PREFIX = 'sha256=';

/** Accepts both a bare hex digest and the full header value from signWebhookBody. */
export function signatureHeader(rawBody: string, secret: string): string {
  const signature = signWebhookBody(rawBody, secret);
  return signature.startsWith(SIGNATURE_PREFIX) ? signature : `${SIGNATURE_PREFIX}${signature}`;
}

export async function postWebhook(
  url: string,
  body: PaymentNotificationBody,
  secret: string,
  options: { badSignature?: boolean } = {},
): Promise<WebhookResponse> {
  const rawBody = JSON.stringify(body);
  const signature = options.badSignature
    ? `${SIGNATURE_PREFIX}${'0'.repeat(64)}`
    : signatureHeader(rawBody, secret);
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-ofl-signature': signature },
    body: rawBody,
  });
  const text = await response.text();
  return { status: response.status, body: text ? (JSON.parse(text) as WebhookResponse['body']) : {} };
}
