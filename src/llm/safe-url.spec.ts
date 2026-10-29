import { assertSafeLlmBaseUrl, isPrivateAddress } from './safe-url';

describe('isPrivateAddress', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.0.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '::1',
    'fd00::1',
    'fe80::1',
    '::ffff:10.0.0.1',
  ])('%s는 내부 주소', (ip) => {
    expect(isPrivateAddress(ip)).toBe(true);
  });

  it.each(['8.8.8.8', '172.32.0.1', '1.1.1.1', '2606:4700::1111'])(
    '%s는 공인 주소',
    (ip) => {
      expect(isPrivateAddress(ip)).toBe(false);
    },
  );
});

describe('assertSafeLlmBaseUrl', () => {
  it.each([
    ['http://8.8.8.8/v1', 'https'],
    ['https://user:pw@8.8.8.8/v1', '계정'],
    ['https://localhost/v1', '내부'],
    ['https://169.254.169.254/latest', '내부'],
    ['https://[::1]/v1', '내부'],
    ['not a url', '형식'],
  ])('%s 거부', async (url, reason) => {
    await expect(assertSafeLlmBaseUrl(url)).rejects.toThrow(reason);
  });

  it('공인 IP https 주소는 허용', async () => {
    await expect(
      assertSafeLlmBaseUrl('https://8.8.8.8/v1'),
    ).resolves.toBeInstanceOf(URL);
  });
});
