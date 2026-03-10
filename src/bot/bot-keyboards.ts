import { Markup } from 'telegraf';

const REFERRAL_SHARE_TEXT = [
  '📥 Telegram storylarni yuklab olish uchun qulay bot!',
  '',
  '✅ Istalgan username bo‘yicha storylarni tekshiradi',
  '🔗 Boshlash uchun quyidagi havolani oching:',
].join('\n');

type InlineKeyboardMarkup = ReturnType<typeof Markup.inlineKeyboard>;

export const BotKeyboards: {
  referralGate: (link: string, current: number) => InlineKeyboardMarkup;
  referralSuccess: () => InlineKeyboardMarkup;
  referralStatus: (link: string, current: number) => InlineKeyboardMarkup;
} = {
  referralGate: (link: string, current: number) =>
    Markup.inlineKeyboard([
      [
        Markup.button.url(
          `📤 Do‘stlarga ulashish`,
          `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(
            REFERRAL_SHARE_TEXT,
          )}`,
        ),
      ],
      [
        Markup.button.callback(
          `📊 Holatni yangilash (${Math.max(0, Math.min(current, 5))}/5)`,
          'referral_status',
        ),
      ],
      [Markup.button.callback(`📋 Havolani nusxalash`, 'referral_copy')],
    ]),

  referralSuccess: () =>
    Markup.inlineKeyboard([
      [
        Markup.button.callback(
          `📥 Story yuklashni davom ettirish`,
          'referral_continue',
        ),
      ],
    ]),

  referralStatus: (link: string, current: number) =>
    Markup.inlineKeyboard([
      [
        Markup.button.url(
          `📤 Ulashish`,
          `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(
            REFERRAL_SHARE_TEXT,
          )}`,
        ),
        Markup.button.callback(
          `🔄 Yangilash (${Math.max(0, Math.min(current, 5))}/5)`,
          'referral_status',
        ),
      ],
    ]),
} as const;
