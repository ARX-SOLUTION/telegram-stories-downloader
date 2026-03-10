import { Markup } from 'telegraf';

type InlineKeyboardMarkup = ReturnType<typeof Markup.inlineKeyboard>;

function buildReferralShareText(link: string): string {
  return [
    '📥 Story Downloader Bot',
    '',
    '✅ Istalgan username bo‘yicha storylarni tekshiradi',
    '🎁 5 ta do‘st taklif qiling va keyingi story sahifalarini oching',
    '',
    `🔗 Boshlash: ${link}`,
  ].join('\n');
}

function buildReferralShareUrl(link: string): string {
  return `https://t.me/share/url?text=${encodeURIComponent(
    buildReferralShareText(link),
  )}`;
}

export const BotKeyboards: {
  referralGate: (link: string, current: number) => InlineKeyboardMarkup;
  referralSuccess: () => InlineKeyboardMarkup;
  referralStatus: (link: string, current: number) => InlineKeyboardMarkup;
  referralCopy: (link: string) => InlineKeyboardMarkup;
} = {
  referralGate: (link: string, current: number) =>
    Markup.inlineKeyboard([
      [
        Markup.button.url(
          `📤 Do‘stlarga ulashish`,
          buildReferralShareUrl(link),
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
        Markup.button.url(`📤 Ulashish`, buildReferralShareUrl(link)),
        Markup.button.callback(
          `🔄 Yangilash (${Math.max(0, Math.min(current, 5))}/5)`,
          'referral_status',
        ),
      ],
      [Markup.button.callback(`📋 Havolani olish`, 'referral_copy')],
    ]),

  referralCopy: (link: string) =>
    Markup.inlineKeyboard([
      [
        Markup.button.url(`🔗 Botni ochish`, link),
        Markup.button.url(`📤 Ulashish`, buildReferralShareUrl(link)),
      ],
    ]),
} as const;
