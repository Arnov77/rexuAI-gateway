export type Model = {
  id: string;
  displayName: string;
  provider: string;
  description: string | null;
  vision: boolean;
  streaming: boolean;
  available: boolean;
  enabled: boolean;
  category: string | null;
  contextWindow: number | null;
  inputModalities: string[];
  outputModalities: string[];
  multiplier: number | null;
  multiplierBp: number | null;
  rcPerMtok: number | null;
  bankaiMultiplier?: number | null;
  bankaiMultiplierBp?: number | null;
  minBlockOverride?: number | null;
  effectiveMinBlock?: string | null;
  createdAt: string;
  lastSyncedAt: string | null;
};

export type RcPackage = {
  id: string;
  name: string;
  priceIdr: number;
  rcAmount: number;
  rcPerRupiah: number;
};

export type AdminRcPackage = RcPackage & {
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
};

export type PaymentOrder = {
  orderId: string;
  midtransOrderId: string;
  amountIdr: number;
  rcAmount: number;
  qrString: string;
  qrImageUrl: string;
  expiresAt: string;
  status: 'pending' | 'paid' | 'expired' | 'failed' | 'cancelled';
};

export type PaymentOrderStatus = {
  orderId: string;
  midtransOrderId: string | null;
  status: 'pending' | 'paid' | 'expired' | 'failed' | 'cancelled';
  amountIdr: number;
  rcAmount: number;
  paidAt: string | null;
  expiresAt: string;
  remainingRc: string;
};

export type PaymentHistoryOrder = {
  id: string;
  packageName: string;
  amountIdr: number;
  rcAmount: number;
  status: 'pending' | 'paid' | 'expired' | 'failed' | 'cancelled';
  paymentType: string;
  midtransOrderId: string | null;
  qrImageUrl: string | null;
  expiresAt: string;
  paidAt: string | null;
  createdAt: string;
};

export type PaymentHistoryResponse = {
  data: PaymentHistoryOrder[];
  total: number;
  page: number;
  pageSize: number;
};

export type Conversation = {
  id: string;
  title: string;
  defaultModelId: string | null;
  updatedAt: string;
};

export type ChatMessage = {
  id: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: unknown;
  modelId: string | null;
  usageLogId: string | null;
  sequence: number;
  createdAt: string;
};

export type UsageLog = {
  id: string;
  modelId: string;
  source: 'api' | 'playground';
  status: string;
  isStream: boolean;
  rawTokens: number;
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  multiplierBp: number | null;
  rcDeducted: string;
  latencyMs: number | null;
  createdAt: string;
};

export type ApiKey = {
  id: string;
  name: string;
  keyPrefix: string;
  lastFour: string;
  status: 'active' | 'revoked';
  rateLimitPerMin: number;
  rcLimit: string | null;
  rcUsed: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

export type AdminWallet = {
  totalRc: string;
  usedRc: string;
  reservedRc: string;
  remainingRc: string;
  expiresAt: string | null;
};

export type AdminUser = {
  id: string;
  email: string;
  name: string;
  role: 'customer' | 'admin';
  status: string;
  createdAt: string;
  lastLoginAt: string | null;
  wallet: AdminWallet;
};

export type AdminUsageLog = {
  id: string;
  userId: string;
  userEmail: string | null;
  modelId: string | null;
  source: 'api' | 'playground';
  status: string;
  isStream: boolean;
  rawTokens: number;
  cachedTokens: number;
  contextTokens: number;
  generationTokens: number;
  multiplierBp: number | null;
  bankaiMultiplierBp: number | null;
  tokensBilled: string;
  tokensReserved: string;
  creditsDeducted: string;
  creditsReserved: string;
  latencyMs: number | null;
  createdAt: string;
};
