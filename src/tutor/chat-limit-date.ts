export const DAILY_CHAT_LIMIT = 5;

// 'en-CA' 로케일은 YYYY-MM-DD 형식으로 포맷됨
const kstDateFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul',
});

/**
 * 챗봇 일일 횟수의 기준 날짜(한국시간).
 * 이전엔 toISOString()(UTC)을 써서 횟수가 한국시간 오전 9시에 초기화됐음.
 */
export function kstToday(now: Date = new Date()): string {
  return kstDateFormat.format(now);
}

export function kstDaysAgo(days: number, now: Date = new Date()): string {
  return kstToday(new Date(now.getTime() - days * 24 * 60 * 60 * 1000));
}
