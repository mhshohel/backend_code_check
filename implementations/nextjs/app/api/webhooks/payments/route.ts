import { observed } from '@/modules/server/http/observe';
import { withGuards } from '@/modules/server/http/guards';
import { handleWebhookRequest } from '@/modules/server/webhook-handler';

export const POST = observed('/api/webhooks/payments', (request, meta) => withGuards(() => handleWebhookRequest(request, meta)));
