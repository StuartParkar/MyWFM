import type { AuthenticatedUser } from "@mywfm/shared";

declare global {
  namespace Express {
    interface Request {
      correlationId: string;
      user?: AuthenticatedUser;
    }
  }
}

export {};
