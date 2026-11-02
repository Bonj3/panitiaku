import { Request, Response } from "express";
import { UnauthorizedError } from "../../shared/errors/app-error.js";
import { env } from "../../config/env.js";
import { authService } from "./auth.service.js";
import {
  LoginSchema,
  RegisterSchema,
  type LoginInput,
  type RegisterInput,
} from "./auth.validator.js";

const SESSION_COOKIE_NAME = "ec_session";
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/" as const,
    maxAge: SESSION_MAX_AGE_MS,
  } as const;
}

function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE_NAME, token, sessionCookieOptions());
}

function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/" as const,
  });
}

function userAgentFromRequest(req: Request): string | undefined {
  const ua = req.headers["user-agent"];
  return typeof ua === "string" ? ua : undefined;
}

export const authController = {
  async register(req: Request, res: Response): Promise<void> {
    const input = RegisterSchema.parse(req.body) as RegisterInput;
    const user = await authService.register(input);
    res.status(201).json({ success: true, data: { user } });
  },

  async login(req: Request, res: Response): Promise<void> {
    const input = LoginSchema.parse(req.body) as LoginInput;
    const { user, token } = await authService.login(input, {
      ip: req.ip,
      userAgent: userAgentFromRequest(req),
    });
    setSessionCookie(res, token);
    res.status(200).json({ success: true, data: { user } });
  },

  async logout(req: Request, res: Response): Promise<void> {
    const token = req.cookies[SESSION_COOKIE_NAME];
    if (typeof token !== "string" || token.length === 0) {
      throw new UnauthorizedError("Sesi tidak tersedia");
    }
    await authService.logout(token);
    clearSessionCookie(res);
    res.status(200).json({ success: true, data: { loggedOut: true } });
  },

  async refresh(req: Request, res: Response): Promise<void> {
    const token = req.cookies[SESSION_COOKIE_NAME];
    if (typeof token !== "string" || token.length === 0) {
      throw new UnauthorizedError("Sesi tidak tersedia");
    }
    const { user, token: newToken } = await authService.refresh(token, {
      ip: req.ip,
      userAgent: userAgentFromRequest(req),
    });
    setSessionCookie(res, newToken);
    res.status(200).json({ success: true, data: { user } });
  },

  async me(req: Request, res: Response): Promise<void> {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedError("Sesi tidak tersedia");
    }
    const result = await authService.me(userId);
    res.status(200).json({ success: true, data: result });
  },
};
