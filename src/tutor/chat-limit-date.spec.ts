import { kstDaysAgo, kstToday } from './chat-limit-date';

describe('kstToday', () => {
  it('UTC 15:00 이후는 한국시간으로 다음 날', () => {
    expect(kstToday(new Date('2026-10-28T14:59:59Z'))).toBe('2026-10-28');
    expect(kstToday(new Date('2026-10-28T15:00:00Z'))).toBe('2026-10-29');
  });

  it('kstDaysAgo는 한국시간 기준 N일 전', () => {
    expect(kstDaysAgo(90, new Date('2026-10-28T15:30:00Z'))).toBe('2026-07-31');
  });
});
