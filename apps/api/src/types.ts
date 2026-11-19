import type { FastifyRequest } from 'fastify';
import '@fastify/cookie';

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  role: 'customer' | 'admin';
};

export type ApiKeyAuth = {
  id: string;
  userId: string;
  name: string;
  rateLimitPerMin: number;
  creditLimit: bigint | null;
  creditsUsed: bigint;
};

declare module 'fastify' {
  interface FastifyRequest {
    authUser: AuthUser | null;
    apiKeyAuth: ApiKeyAuth | null;
  }
}

export type RequestWithUser = FastifyRequest & { authUser: AuthUser };
export type RequestWithApiKey = FastifyRequest & { apiKeyAuth: ApiKeyAuth };
