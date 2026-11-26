import { Controller, HttpCode, Inject, Post, Req, Res, UseGuards } from '@nestjs/common';
import { login, logout, SESSION_COOKIE_NAME, sessionCookieOptions, type Services } from '@ofl/server-core';
import type { CookieOptions, Request, Response } from 'express';
import { ApiError } from '../common/api-error';
import { CsrfGuard } from '../common/csrf.guard';
import { RateLimit } from '../common/decorators';
import { RateLimitGuard } from '../common/rate-limit.guard';
import { requestMeta } from '../common/request-meta';
import { SERVICES } from '../tokens';

/**
 * POST /auth/login and /auth/logout. Nest owns the cookie; server-core owns
 * sessions. Guards run in the listed order: CSRF first, then the login
 * rate limit (only on login, via @RateLimit on the handler).
 */
@Controller('auth')
@UseGuards(CsrfGuard, RateLimitGuard)
export class AuthController {
  constructor(@Inject(SERVICES) private readonly services: Services) {}

  private cookieOptions(): CookieOptions {
    const options = sessionCookieOptions(this.services.config);
    return { httpOnly: options.httpOnly, sameSite: options.sameSite, secure: options.secure, path: options.path };
  }

  @Post('login')
  @HttpCode(200)
  @RateLimit('login')
  async login(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    // Invalid input throws AppError BAD_USER_INPUT; the exception filter answers 400.
    const result = await login(this.services, req.body, requestMeta(req, res));
    if (result.kind === 'invalid') throw new ApiError(401, 'The email or password is incorrect.');
    const maxAgeMs = sessionCookieOptions(this.services.config).maxAgeSeconds * 1000;
    res.cookie(SESSION_COOKIE_NAME, result.token, { ...this.cookieOptions(), maxAge: maxAgeMs });
    return { user: result.user };
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    const cookies: Record<string, unknown> = req.cookies ?? {};
    const token = cookies[SESSION_COOKIE_NAME];
    await logout(this.services, typeof token === 'string' ? token : undefined);
    res.clearCookie(SESSION_COOKIE_NAME, this.cookieOptions());
  }
}
