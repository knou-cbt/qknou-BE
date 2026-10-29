import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * 사용자가 입력한 LLM base URL 검증.
 * 서버가 이 주소로 직접 요청을 보내므로, 그대로 두면 사용자가 서버를 시켜
 * 내부망(메타데이터 서버 169.254.169.254, DB, 다른 컨테이너 등)을 호출하게
 * 만들 수 있다(SSRF). https + 공인 IP로만 해석되는 호스트만 허용한다.
 *
 * DNS를 검사 시점과 실제 연결 시점에 따로 조회하므로 DNS 리바인딩까지 완전히
 * 막지는 못한다 — 호출 직전에 매번 다시 검사하고, 리다이렉트는 따라가지 않게
 * (fetchOptions.redirect = 'error') 해서 범위를 줄인다.
 */
export class UnsafeUrlError extends Error {}

export async function assertSafeLlmBaseUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError('올바른 URL 형식이 아닙니다.');
  }

  if (url.protocol !== 'https:') {
    throw new UnsafeUrlError('https 주소만 사용할 수 있습니다.');
  }
  if (url.username || url.password) {
    throw new UnsafeUrlError('URL에 계정 정보를 넣을 수 없습니다.');
  }

  // URL 파서는 IPv6를 [::1]처럼 대괄호로 감싸서 돌려줌
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost')) {
    throw new UnsafeUrlError('내부 주소는 사용할 수 없습니다.');
  }

  let addresses: string[];
  if (isIP(host)) {
    addresses = [host];
  } else {
    try {
      addresses = (await lookup(host, { all: true, verbatim: true })).map(
        (a) => a.address,
      );
    } catch {
      throw new UnsafeUrlError('호스트 주소를 찾을 수 없습니다.');
    }
  }

  if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
    throw new UnsafeUrlError('내부 주소는 사용할 수 없습니다.');
  }
  return url;
}

export function isPrivateAddress(address: string): boolean {
  const v = isIP(address);
  if (v === 4) return isPrivateIPv4(address);
  if (v === 6) {
    const lower = address.toLowerCase();
    // IPv4-mapped (::ffff:10.0.0.1) → IPv4 규칙으로 판단
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIPv4(mapped[1]);
    return (
      lower === '::' ||
      lower === '::1' ||
      lower.startsWith('fc') || // fc00::/7 고유 로컬
      lower.startsWith('fd') ||
      /^fe[89ab]/.test(lower) || // fe80::/10 링크 로컬
      lower.startsWith('ff') || // 멀티캐스트
      lower.startsWith('::ffff:') // 그 외 매핑 표기는 보수적으로 차단
    );
  }
  return true;
}

function isPrivateIPv4(address: string): boolean {
  const [a, b] = address.split('.').map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) || // 링크 로컬 (클라우드 메타데이터)
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) || // 벤치마크용
    a >= 224 // 멀티캐스트/예약
  );
}
