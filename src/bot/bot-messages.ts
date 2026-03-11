import { LoginState } from '../user-client/user-client.types';

const REFERRAL_GOAL = 5;

function clampReferralCount(count: number): number {
  return Math.max(0, Math.min(count, REFERRAL_GOAL));
}

function buildReferralBar(count: number): string {
  const safeCount = clampReferralCount(count);
  return `${'🟩'.repeat(safeCount)}${'⬜️'.repeat(REFERRAL_GOAL - safeCount)}`;
}

export const BotMessages = {
  start: (isReturning: boolean, botUsername?: string) =>
    isReturning
      ? [
          '👋 <b>Qaytib keldingiz!</b>',
          '',
          '📥 Story yuklash uchun <code>@username</code> yuboring',
          '👥 Referal holatini ko‘rish: <code>/referral</code>',
          '🔐 Login holati: <code>/status</code>',
          botUsername
            ? `🔗 Inline rejim: <code>@${botUsername} @target</code>`
            : '',
        ]
          .filter(Boolean)
          .join('\n')
      : [
          '👋 <b>Story Downloader Botga xush kelibsiz!</b>',
          '',
          '📥 <b>Qanday ishlaydi?</b>',
          'Shunchaki Telegram <code>@username</code> yuboring',
          'Bot o‘sha odamning ko‘rinadigan storylarini yuklaydi',
          '',
          '📄 Har safar <b>5 ta</b> story (eng yangidan)',
          '🔓 <b>5 ta do‘st taklif qiling</b> → keyingi sahifalar ochiladi',
          botUsername
            ? `🔗 Inline rejim: <code>@${botUsername} @target</code>`
            : '',
          '',
          '▶️ Boshlash uchun: <code>/login</code> yoki <code>@username</code> yuboring',
        ]
          .filter(Boolean)
          .join('\n'),

  dialogsEmpty: () =>
    [
      '📭 <b>Dialoglar topilmadi</b>',
      '',
      'Hozircha ko‘rsatish uchun chat yo‘q.',
      '🔄 Keyinroq <code>/dialogs</code> ni qayta urinib ko‘ring.',
    ].join('\n'),

  dialogs: (items: string[]) =>
    ['📋 <b>So‘nggi dialoglar</b>', '', ...items].join('\n'),

  dialogsError: (reason: string) =>
    [
      '❌ <b>Dialoglarni olib bo‘lmadi</b>',
      '',
      `📋 Sabab: ${reason}`,
      '',
      '🔄 Qayta urinish: <code>/dialogs</code>',
      '🔐 Holatni tekshirish: <code>/status</code>',
    ].join('\n'),

  loginLocked: () =>
    [
      '🔒 <b>Login band</b>',
      '',
      'Login jarayoni boshqa chatda davom etyapti.',
      '⏳ O‘sha chatdagi jarayon tugashini kuting.',
    ].join('\n'),

  loginAlreadyAuthorized: () =>
    [
      '✅ <b>Siz allaqachon tizimga kirgansiz!</b>',
      '',
      '📥 Story yuklash uchun <code>@username</code> yuboring',
      '🔍 Holatni tekshirish: <code>/status</code>',
    ].join('\n'),

  loginStart: () =>
    [
      '🔑 <b>Tizimga kirish</b>',
      '',
      '📱 Telegram raqamingizni yuboring',
      'Format: <code>+998901234567</code>',
      '',
      '❌ Bekor qilish: <code>/cancel</code>',
    ].join('\n'),

  loginWaitingCode: (phone?: string) =>
    [
      '📲 <b>Tasdiqlash kodi</b>',
      '',
      phone
        ? `<code>${phone}</code> raqamiga SMS kod yuborildi`
        : 'Telegram akkauntingizga tasdiqlash kodi yuborildi',
      'Kodni yuboring: <code>12345</code>',
      '',
      '⚠️ Kodni hech kimga bermang!',
      '❌ Bekor qilish: <code>/cancel</code>',
    ].join('\n'),

  loginWaitingPassword: () =>
    [
      '🔐 <b>Ikki bosqichli himoya</b>',
      '',
      'Telegram parolingizni yuboring',
      '',
      '⚠️ Parolni hech kimga bermang!',
      '❌ Bekor qilish: <code>/cancel</code>',
    ].join('\n'),

  loginSuccess: () =>
    [
      '✅ <b>Muvaffaqiyatli kirdingiz!</b>',
      '',
      '📥 Endi story yuklash mumkin.',
      '<code>@username</code> yuboring — boshlaymiz!',
    ].join('\n'),

  loginError: (reason: string) =>
    [
      '❌ <b>Kirish xatosi</b>',
      '',
      `📋 Sabab: ${reason}`,
      '',
      '🔄 Qayta urinish: <code>/login</code>',
      '💬 Muammo davom etsa: <code>/help</code>',
    ].join('\n'),

  loginCancelled: () =>
    [
      '🚫 <b>Kirish bekor qilindi</b>',
      '',
      '🔄 Qayta boshlash: <code>/login</code>',
    ].join('\n'),

  loginInactive: () =>
    [
      'ℹ️ <b>Login aktiv emas</b>',
      '',
      'Hozir login uchun ma’lumot kutilmayapti.',
      '▶️ Boshlash uchun: <code>/login</code>',
    ].join('\n'),

  contactIgnored: () =>
    [
      'ℹ️ <b>Kontakt qabul qilinmadi</b>',
      '',
      'Interaktiv login hozir faol emas.',
      '▶️ Kerak bo‘lsa: <code>/login</code>',
    ].join('\n'),

  status: (state: LoginState, phone?: string | null) => {
    const stateMap: Record<LoginState, string> = {
      idle: '⚪️ Kutilmoqda',
      waiting_phone: '📱 Telefon raqam kutilmoqda',
      waiting_code: '📲 Tasdiqlash kodi kutilmoqda',
      waiting_password: '🔐 Parol kutilmoqda',
      authorized: '✅ Tizimga kirilgan',
      error: '❌ Xatolik',
    };

    const nextMap: Record<LoginState, string> = {
      idle: '▶️ Boshlash uchun: <code>/login</code>',
      waiting_phone: '📱 Telefon raqamingizni yuboring',
      waiting_code: '📲 SMS kodini yuboring',
      waiting_password: '🔐 Parolingizni yuboring',
      authorized: '📥 <code>@username</code> yuboring',
      error: '🔄 Qayta urinish: <code>/login</code>',
    };

    return [
      '📊 <b>Holat</b>',
      '',
      `🔘 Login: <b>${stateMap[state]}</b>`,
      phone ? `📱 Raqam: <code>${phone}</code>` : '',
      '',
      nextMap[state],
    ]
      .filter(Boolean)
      .join('\n');
  },

  storyLoading: (username: string, page: number) =>
    [
      '⏳ <b>Yuklanmoqda...</b>',
      '',
      `👤 Foydalanuvchi: <code>@${username}</code>`,
      `📄 Sahifa: <b>${page + 1}</b>`,
      `🔢 Ko‘rsatiladi: <b>${page * 5 + 1}–${page * 5 + 5}</b> ta story`,
    ].join('\n'),

  storyCaption: (
    formattedDate: string,
    storyId: number,
    page: number,
    pagesCount: number,
  ) =>
    `📅 ${formattedDate} | Story #${storyId} | Sahifa ${page + 1}/${pagesCount || 1}`,

  storyPageDone: (
    username: string,
    page: number,
    pagesCount: number,
    from: number,
    to: number,
    total: number,
    failed = 0,
  ) =>
    [
      '✅ <b>Yuklandi!</b>',
      '',
      `👤 <code>@${username}</code>`,
      `📄 Sahifa: <b>${page + 1}/${pagesCount}</b>`,
      `🖼 Ko‘rsatildi: <b>${from}–${to}</b> ta`,
      `📦 Jami story: <b>${total}</b> ta`,
      failed > 0 ? `⚠️ Yuborilmadi: <b>${failed}</b> ta` : '',
    ]
      .filter(Boolean)
      .join('\n'),

  storyEmpty: (username: string) =>
    [
      '⚠️ <b>Story topilmadi</b>',
      '',
      `👤 <code>@${username}</code> foydalanuvchida`,
      'hech qanday story mavjud emas.',
      '',
      '🔍 Username to‘g‘riligini tekshiring.',
    ].join('\n'),

  storyUserNotFound: (username: string) =>
    [
      '❌ <b>Foydalanuvchi topilmadi</b>',
      '',
      `👤 <code>@${username}</code> mavjud emas.`,
      '',
      '✏️ Username to‘g‘ri kiritilganini tekshiring.',
    ].join('\n'),

  storyPrivateAccount: (username: string) =>
    [
      '🔒 <b>Yopiq profil</b>',
      '',
      `👤 <code>@${username}</code> profilini ko‘rish uchun ruxsat yo‘q.`,
      '',
      'ℹ️ Faqat ochiq yoki ruxsat berilgan profillar ishlaydi.',
    ].join('\n'),

  storyFloodWait: (seconds: number) =>
    [
      '⏱ <b>Telegram limit</b>',
      '',
      '⚠️ Juda ko‘p so‘rov yuborildi.',
      `🕐 Kuting: <b>${seconds}</b> soniya`,
      '',
      '🔄 Keyin qayta urinib ko‘ring.',
    ].join('\n'),

  storyNotAuthorized: () =>
    [
      '🔐 <b>Tizimga kirish kerak</b>',
      '',
      'Story yuklab olish uchun avval Telegram akkauntingizga kiring.',
      '',
      '▶️ Kirish: <code>/login</code>',
    ].join('\n'),

  referralGate: (current: number, link: string) => {
    const safeCount = clampReferralCount(current);
    const needed = REFERRAL_GOAL - safeCount;
    const percent = Math.round((safeCount / REFERRAL_GOAL) * 100);

    return [
      '🔒 <b>Qo‘shimcha story yuklash yopiq</b>',
      '',
      '━━━━━━━━━━━━━━━━━',
      `${buildReferralBar(safeCount)}  <b>${percent}%</b>`,
      '━━━━━━━━━━━━━━━━━',
      '',
      `👥 Do‘stlar: <b>${safeCount}/${REFERRAL_GOAL}</b> ta taklif`,
      `🎯 Maqsad: yana <b>${needed}</b> ta do‘st kerak`,
      '',
      '💡 <b>Nima qilish kerak?</b>',
      'Quyidagi <b>Ulashish</b> tugmasini bosing.',
      'Do‘stlaringizni tanlang va yuboring.',
      'Ular botga kirsa — hisoblanadi ✅',
      '',
      link ? '🔗 Taklif havolangiz pastdagi tugmalarda tayyor.' : '',
      '🎁 <b>5 ta to‘lsa:</b> cheksiz story yuklash!',
    ]
      .filter(Boolean)
      .join('\n');
  },

  referralStatus: (count: number, link: string) =>
    count >= REFERRAL_GOAL
      ? [
          '🎉 <b>Referal maqsadiga yetdingiz!</b>',
          '',
          '━━━━━━━━━━━━━━━━━',
          `🟩🟩🟩🟩🟩  <b>100%</b>`,
          '━━━━━━━━━━━━━━━━━',
          '',
          `✅ Taklif qilganlar: <b>${count}/${REFERRAL_GOAL}</b>`,
          '🔓 Barcha story sahifalari ochiq.',
          '',
          '📥 <code>@username</code> yuboring!',
        ].join('\n')
      : [
          '👥 <b>Referal holati</b>',
          '',
          '━━━━━━━━━━━━━━━━━',
          `${buildReferralBar(count)}  <b>${Math.round((clampReferralCount(count) / REFERRAL_GOAL) * 100)}%</b>`,
          '━━━━━━━━━━━━━━━━━',
          '',
          `📊 Taklif qilganlar: <b>${clampReferralCount(count)}/${REFERRAL_GOAL}</b>`,
          `👥 Yana kerak: <b>${REFERRAL_GOAL - clampReferralCount(count)}</b> ta do‘st`,
          '',
          link ? '🔗 Taklif havolangiz pastdagi tugmalarda tayyor.' : '',
          '📤 Ulashish yoki nusxalash uchun tugmalardan foydalaning.',
        ].join('\n'),

  referralSuccess: (count: number) =>
    [
      '🎉 <b>Maqsadga yetdingiz!</b>',
      '',
      '━━━━━━━━━━━━━━━━━',
      '🟩🟩🟩🟩🟩  <b>100%</b>',
      '━━━━━━━━━━━━━━━━━',
      '',
      `👥 Taklif qilganlar: <b>${count}/${REFERRAL_GOAL}</b> ✅`,
      '',
      '🔓 <b>Barcha storylarga kirish ochiq!</b>',
      '📥 Davom etish uchun tugmani bosing.',
    ].join('\n'),

  referralCopy: (link: string) =>
    [
      '🔗 <b>Taklif havolangiz tayyor</b>',
      '',
      'Linkni chiroyli ko‘rinishda ulashish uchun pastdagi tugmalardan foydalaning.',
      '',
      `<a href="${link}">Taklif havolasini ochish</a>`,
      '',
      '📋 Nusxalash kerak bo‘lsa, havolani bosib ushlab turing.',
    ].join('\n'),

  referralContinue: () =>
    [
      '✅ <b>Cheksiz yuklash faollashdi!</b>',
      '',
      '📥 Endi keyingi sahifalarni ham ochishingiz mumkin.',
      '<code>@username</code> yuboring — davom etamiz!',
    ].join('\n'),

  referralStatusToast: () => '📊 Holat yangilanmoqda...',

  referralCopyToast: () => '✅ Havola tayyor.',

  referralContinueToast: () => '🎉 Ruxsat faollashdi.',

  referralNewUser: () =>
    [
      '👋 <b>Xush kelibsiz!</b>',
      '',
      '✅ Siz do‘stingiz taklifi bilan keldingiz.',
      'Do‘stingiz uchun +1 ball qo‘shildi 🎁',
      '',
      '📥 Boshlash: <code>@username</code> yuboring.',
    ].join('\n'),

  inlineHint: () =>
    [
      '📥 <b>Story Downloader</b>',
      '@username yozing — storylarni tekshiramiz.',
    ].join('\n'),

  inlineLoading: (username: string) =>
    `⏳ <b>@${username}</b> ning storylari yuklanmoqda...`,

  inlineDownloadTitle: (username: string) =>
    `📥 @${username} — storylarini yuklash`,

  inlineCountTitle: (username: string) =>
    `📊 @${username} — story sonini ko‘rish`,

  inlineCount: (username: string, count: number) =>
    [
      `📊 <b>@${username}</b>`,
      '',
      `🖼 Jami story: <b>${count}</b> ta`,
      '',
      '📥 Yuklash uchun: <code>@username</code> yuboring.',
    ].join('\n'),

  unknownError: () =>
    [
      '❌ <b>Noma’lum xatolik</b>',
      '',
      '🔄 Qayta urinib ko‘ring.',
      '💬 Muammo davom etsa: <code>/help</code>',
    ].join('\n'),

  notAuthorized: () =>
    [
      '🔐 <b>Ruxsat yo‘q</b>',
      '',
      'Avval tizimga kiring: <code>/login</code>',
    ].join('\n'),

  userNotDetected: () =>
    [
      '❌ <b>Foydalanuvchi aniqlanmadi</b>',
      '',
      'Telegram foydalanuvchi ma’lumotini topib bo‘lmadi.',
      '🔄 Qayta urinib ko‘ring.',
    ].join('\n'),

  chatNotDetected: () =>
    [
      '❌ <b>Chat aniqlanmadi</b>',
      '',
      'Javob yuborish uchun chat ma’lumoti topilmadi.',
      '🔄 Qayta urinib ko‘ring.',
    ].join('\n'),

  pageInvalid: () => 'Sahifa ma’lumoti noto‘g‘ri.',

  pageLoading: (page: number) => `📄 ${page + 1}-sahifa yuklanmoqda...`,

  usageStories: () =>
    [
      'ℹ️ <b>Ishlatish</b>',
      '',
      '📥 Shunchaki yuboring: <code>@username</code>',
      'Yoki: <code>/stories @username</code>',
    ].join('\n'),

  youtubeLoading: () =>
    [
      '⏳ <b>YouTube yuklanmoqda...</b>',
      '',
      '🔗 Havola tekshirilyapti va media tayyorlanmoqda.',
    ].join('\n'),

  youtubeDone: (title: string) =>
    [
      '✅ <b>YouTube media yuborildi</b>',
      '',
      `🎬 Nomi: <code>${title}</code>`,
    ].join('\n'),

  youtubeInvalidLink: () =>
    [
      '❌ <b>YouTube havolasi noto‘g‘ri</b>',
      '',
      'Quyidagi formatlardan birini yuboring:',
      '• <code>https://www.youtube.com/watch?v=...</code>',
      '• <code>https://youtu.be/...</code>',
      '• <code>https://youtube.com/shorts/...</code>',
    ].join('\n'),

  youtubeUnsupported: () =>
    [
      '⚠️ <b>Kontent qo‘llab-quvvatlanmaydi</b>',
      '',
      'Bu YouTube havoladan media yuklab bo‘lmadi.',
    ].join('\n'),

  youtubeDownloadFailed: () =>
    [
      '❌ <b>YouTube yuklab bo‘lmadi</b>',
      '',
      'Hozircha media olishda xatolik yuz berdi. Keyinroq qayta urinib ko‘ring.',
    ].join('\n'),

  youtubeToolNotInstalled: () =>
    [
      '⚠️ <b>YouTube xizmat hozircha tayyor emas</b>',
      '',
      'Serverda <code>yt-dlp</code> yoki <code>ffmpeg</code> topilmadi.',
      'Iltimos, administratorga murojaat qiling.',
    ].join('\n'),

  youtubeAuthRequired: () =>
    [
      '⚠️ <b>Video vaqtincha cheklangan</b>',
      '',
      'YouTube bu video uchun tasdiqlash talab qilmoqda.',
      'Iltimos, keyinroq qayta urinib ko‘ring.',
    ].join('\n'),

  youtubeFileTooLarge: () =>
    [
      '⚠️ <b>Fayl juda katta</b>',
      '',
      'Bu videoning hajmi Telegram yuborish limiti uchun juda katta.',
    ].join('\n'),

  help: (botUsername?: string) =>
    [
      'ℹ️ <b>Story Downloader — Yordam</b>',
      '',
      '<b>📥 Story yuklash:</b>',
      '<code>@username</code> yuboring',
      '<code>/stories @username</code>',
      '',
      '<b>▶️ YouTube yuklash:</b>',
      '<code>https://www.youtube.com/watch?v=...</code>',
      '<code>https://youtu.be/...</code>',
      '',
      '<b>📄 Sahifalash:</b>',
      '5 tadan yuklanadi (eng yangidan).',
      'Keyingi sahifa tugmasini bosing.',
      '',
      '<b>🔓 Ko‘proq story:</b>',
      '5 ta do‘stni taklif qiling → <code>/referral</code>',
      botUsername
        ? `\n<b>🔗 Inline rejim:</b>\n<code>@${botUsername} @target</code>`
        : '',
      '',
      '<b>🔐 Kirish:</b>',
      '<code>/login</code> — kirish',
      '<code>/status</code> — holat',
      '<code>/cancel</code> — bekor qilish',
    ]
      .filter(Boolean)
      .join('\n'),
} as const;
