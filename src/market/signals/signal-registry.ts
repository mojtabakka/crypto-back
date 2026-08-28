import type { SignalLevel } from './signal-result';

export interface SignalDefinition {
  code: string;

  title: string;

  level: SignalLevel;

  score: number;

  message: string;
}

/**
 * تمام Signalهای سیستم
 *
 * این فایل مرجع اصلی اطلاعات Signalهاست.
 *
 * Ruleها فقط مشخص می‌کنند:
 *
 * "این Signal اتفاق افتاد"
 *
 * اما اطلاعات Signal اینجا نگهداری می‌شود.
 */
export const SIGNAL_REGISTRY: Record<string, SignalDefinition> = {
  // =========================================
  // Bullish
  // =========================================

  STRONG_BULLISH: {
    code: 'STRONG_BULLISH',

    title: 'روند صعودی قوی',

    level: 'BULLISH',

    score: 70,

    message: 'ورود پوزیشن‌های جدید همراه با رشد قیمت؛ روند صعودی قدرت دارد.',
  },

  HEALTHY_BULLISH: {
    code: 'HEALTHY_BULLISH',

    title: 'صعود سالم‌تر',

    level: 'BULLISH',

    score: 55,

    message: 'رشد قیمت با افزایش فعالیت، بدون شلوغ‌شدن شدید لانگ‌ها.',
  },

  LONG_PUMP: {
    code: 'LONG_PUMP',

    title: 'پامپ / لانگ‌محور',

    level: 'WARNING',

    score: 68,

    message:
      'مومنتوم شدید است؛ هرچه Funding بالاتر برود، ریسک Long Squeeze بیشتر می‌شود.',
  },

  SHORT_SQUEEZE: {
    code: 'SHORT_SQUEEZE',

    title: 'شورت‌اسکوئیز',

    level: 'BULLISH',

    score: 95,

    message:
      'قیمت به‌شدت افزایش یافته و Open Interest کاهش یافته است؛ احتمال بسته‌شدن یا لیکوییدشدن شورت‌ها وجود دارد.',
  },

  // =========================================
  // Bearish
  // =========================================

  NORMAL_CORRECTION: {
    code: 'NORMAL_CORRECTION',

    title: 'اصلاح عادی',

    level: 'BEARISH',

    score: 40,

    message: 'بخشی از پوزیشن‌ها بسته شده؛ می‌تواند یک اصلاح طبیعی باشد.',
  },

  SHORT_BUILDING: {
    code: 'SHORT_BUILDING',

    title: 'شورت‌سازی / فشار فروش',

    level: 'BEARISH',

    score: 80,

    message:
      'قیمت در حال کاهش است و Open Interest افزایش یافته؛ احتمال اضافه‌شدن پوزیشن‌های شورت وجود دارد.',
  },

  // =========================================
  // Warning
  // =========================================

  LONG_FLUSH: {
    code: 'LONG_FLUSH',

    title: 'ریزش با تخلیه لانگ',

    level: 'WARNING',

    score: 90,

    message:
      'خروج یا لیکوییدشدن لانگ‌ها؛ احتمال Long Squeeze / Deleveraging بالا است.',
  },

  LONG_WARNING: {
    code: 'LONG_WARNING',

    title: 'هشدار برای لانگ‌ها',

    level: 'WARNING',

    score: 75,

    message:
      'قیمت در حال کاهش است اما پوزیشن‌های جدید باز می‌شوند؛ احتمال گیر افتادن لانگ‌ها بالاست.',
  },

  SEVERE_LONG_SQUEEZE: {
    code: 'SEVERE_LONG_SQUEEZE',

    title: 'ریزش شدید / لانگ‌اسکوئیز',

    level: 'WARNING',

    score: 100,

    message:
      'قیمت و Open Interest به‌شدت کاهش یافته و حجم افزایش یافته است؛ احتمال تخلیه شدید اهرم و Long Squeeze وجود دارد.',
  },

  PUMP_DISTRIBUTION_RISK: {
    code: 'PUMP_DISTRIBUTION_RISK',

    title: 'پامپ با احتمال تخلیه',

    level: 'WARNING',

    score: 65,

    message:
      'روند هنوز صعودی است، اما افزایش هم‌زمان قیمت، Open Interest و Funding می‌تواند نشان‌دهنده ازدحام لانگ‌ها و افزایش ریسک اصلاح شدید باشد.',
  },
};
