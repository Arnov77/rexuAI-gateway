import type { schema } from '@rexu/db';
import { getEffectiveMinBlock } from '../modules/billing/service.js';

type ModelRow = typeof schema.models.$inferSelect;
type WalletRow = typeof schema.wallets.$inferSelect;

export function bigintString(value: bigint | null | undefined): string | null {
  return value == null ? null : value.toString();
}

export function multiplierDecimal(multiplierBp: number | null): number | null {
  return multiplierBp == null ? null : multiplierBp / 10_000;
}

export function serializeModel(
  model: ModelRow,
  showMultiplier: boolean,
  showBankaiMultiplier = false,
) {
  return {
    id: model.id,
    object: 'model',
    displayName: model.displayName,
    provider: model.provider,
    description: model.description,
    vision: model.vision,
    streaming: model.streaming,
    available: model.isAvailable,
    enabled: model.isEnabled,
    category: model.category,
    contextWindow: model.contextWindow,
    inputModalities: model.inputModalities,
    outputModalities: model.outputModalities,
    multiplier: showMultiplier ? multiplierDecimal(model.multiplierBp) : null,
    multiplierBp: showMultiplier ? model.multiplierBp : null,
    // Harga jual per 1 juta token, diturunkan dari tarif BankAI.
    // Nilai bp mentah tidak diekspos ke endpoint user.
    rcPerMtok: Math.round((model.bankaiMultiplierBp ?? 10_000) / 10),
    ...(showBankaiMultiplier
      ? {
          bankaiMultiplier: multiplierDecimal(model.bankaiMultiplierBp),
          bankaiMultiplierBp: model.bankaiMultiplierBp,
          minBlockOverride: model.minBlockOverride,
          effectiveMinBlock: getEffectiveMinBlock(
            model.bankaiMultiplierBp,
            model.minBlockOverride,
          ).toString(),
        }
      : {}),
    createdAt: model.createdAt,
    lastSyncedAt: model.lastSyncedAt,
  };
}

export function serializeWallet(wallet: WalletRow | null | undefined) {
  if (!wallet) {
    return {
      totalRc: '0',
      usedRc: '0',
      reservedRc: '0',
      remainingRc: '0',
      expiresAt: null,
    };
  }

  return {
    totalRc: wallet.totalCredits.toString(),
    usedRc: wallet.usedCredits.toString(),
    reservedRc: wallet.reservedCredits.toString(),
    remainingRc: (wallet.totalCredits - wallet.usedCredits - wallet.reservedCredits).toString(),
    expiresAt: wallet.expiresAt,
  };
}
