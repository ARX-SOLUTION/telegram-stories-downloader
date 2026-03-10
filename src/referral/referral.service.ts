import { Injectable } from '@nestjs/common';

@Injectable()
export class ReferralService {
  static readonly REQUIRED_REFERRALS = 5;

  private readonly referrals = new Map<number, Set<number>>();
  private readonly referredBy = new Map<number, number>();

  // TODO: Replace in-memory storage with persistent DB storage.
  getReferralCount(userId: number): number {
    return this.referrals.get(userId)?.size ?? 0;
  }

  registerReferral(referrerId: number, newUserId: number): boolean {
    if (
      !Number.isSafeInteger(referrerId) ||
      !Number.isSafeInteger(newUserId) ||
      referrerId <= 0 ||
      newUserId <= 0 ||
      referrerId === newUserId ||
      this.referredBy.has(newUserId)
    ) {
      return false;
    }

    if (!this.referrals.has(referrerId)) {
      this.referrals.set(referrerId, new Set());
    }

    const referrals = this.referrals.get(referrerId);
    if (!referrals || referrals.has(newUserId)) {
      return false;
    }

    referrals.add(newUserId);
    this.referredBy.set(newUserId, referrerId);
    return true;
  }

  hasAccess(userId: number): boolean {
    return this.getReferralCount(userId) >= ReferralService.REQUIRED_REFERRALS;
  }

  getRemainingReferrals(userId: number): number {
    return Math.max(
      0,
      ReferralService.REQUIRED_REFERRALS - this.getReferralCount(userId),
    );
  }

  generateReferralLink(userId: number, botUsername: string): string {
    return `https://t.me/${botUsername}?start=ref_${userId}`;
  }
}
