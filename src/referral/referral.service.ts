import { Injectable } from '@nestjs/common';
import { UserRepository } from '../database/user.repository';

export interface ReferralAccessStatus {
  referralCount: number;
  hasFullAccess: boolean;
  remainingReferrals: number;
}

@Injectable()
export class ReferralService {
  static readonly REQUIRED_REFERRALS = 5;

  constructor(private readonly userRepository: UserRepository) {}

  async getReferralCount(userId: number): Promise<number> {
    return this.userRepository.getReferralCount(userId);
  }

  async registerReferral(
    referrerId: number,
    newUserId: number,
  ): Promise<boolean> {
    return this.userRepository.registerReferral(referrerId, newUserId);
  }

  async hasAccess(userId: number): Promise<boolean> {
    return this.userRepository.hasFullAccess(userId);
  }

  async getReferralStatus(userId: number): Promise<ReferralAccessStatus> {
    const referralCount = await this.getReferralCount(userId);
    const hasFullAccess =
      referralCount >= ReferralService.REQUIRED_REFERRALS ||
      (await this.hasAccess(userId));

    return {
      referralCount,
      hasFullAccess,
      remainingReferrals: Math.max(
        0,
        ReferralService.REQUIRED_REFERRALS - referralCount,
      ),
    };
  }

  generateReferralLink(userId: number, botUsername: string): string {
    return `https://t.me/${botUsername}?start=ref_${userId}`;
  }
}
