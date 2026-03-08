/**
 * 코드 블록 포맷팅 유틸리티
 * DB에 들여쓰기 없이 저장된 코드 블록을 자동으로 포맷팅
 */

/**
 * C/C++ 코드의 들여쓰기를 자동으로 추가
 */
function formatCppCode(code: string): string {
  const lines = code.split('\n');
  const formatted: string[] = [];
  let indentLevel = 0;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim();
    if (!line) {
      formatted.push('');
      continue;
    }

    // public:, private:, protected: 레이블 처리
    if (/^(public|private|protected)\s*:/.test(line)) {
      indentLevel = Math.max(0, indentLevel - 1);
      const indent = '  '.repeat(indentLevel);
      formatted.push(indent + line);
      indentLevel++;
      continue;
    }

    // 닫는 중괄호는 들여쓰기 감소 먼저
    if (line.startsWith('}')) {
      indentLevel = Math.max(0, indentLevel - 1);
    }

    // 현재 줄 추가
    const indent = '  '.repeat(indentLevel);
    formatted.push(indent + line);

    // 여는 중괄호면 다음 줄부터 들여쓰기 증가
    if (line.endsWith('{')) {
      indentLevel++;
    }
    // } else if, } else 같은 패턴 처리
    else if (line.startsWith('}') && (line.includes('else') || line.includes('catch'))) {
      if (line.endsWith('{')) {
        indentLevel++;
      }
    }
    // 중괄호 없는 제어문 처리 (if, for, while 등)
    // 조건: 제어문으로 시작하고 중괄호가 없으면 다음 한 줄만 들여쓰기
    else if (/^(if|for|while|else)\s*\(/.test(line) && !line.includes('{')) {
      // 다음 줄이 존재하고, 중괄호나 제어문이 아니면 임시로 들여쓰기 증가
      if (i < lines.length - 1) {
        const nextLine = lines[i + 1].trim();
        if (nextLine && !nextLine.startsWith('{') && !/^(if|for|while|else)/.test(nextLine)) {
          indentLevel++;
          // 다음 줄 처리 후 바로 감소시킬 플래그
          i++;
          const nextIndent = '  '.repeat(indentLevel);
          formatted.push(nextIndent + nextLine);
          indentLevel = Math.max(0, indentLevel - 1);
        }
      }
    }
  }

  return formatted.join('\n');
}

/**
 * Java 코드의 들여쓰기를 자동으로 추가
 */
function formatJavaCode(code: string): string {
  const lines = code.split('\n');
  const formatted: string[] = [];
  let indentLevel = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) {
      formatted.push('');
      continue;
    }

    // 닫는 중괄호는 들여쓰기 감소 먼저
    if (line.startsWith('}')) {
      indentLevel = Math.max(0, indentLevel - 1);
    }

    // 현재 줄 추가
    const indent = '  '.repeat(indentLevel);
    formatted.push(indent + line);

    // 여는 중괄호면 다음 줄부터 들여쓰기 증가
    if (line.endsWith('{')) {
      indentLevel++;
    }
  }

  return formatted.join('\n');
}

/**
 * Python 코드의 들여쓰기를 자동으로 추가
 */
function formatPythonCode(code: string): string {
  const lines = code.split('\n');
  const formatted: string[] = [];
  let indentLevel = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) {
      formatted.push('');
      continue;
    }

    // 현재 줄 추가
    const indent = '  '.repeat(indentLevel);
    formatted.push(indent + line);

    // 콜론으로 끝나면 다음 줄 들여쓰기 증가
    if (line.endsWith(':')) {
      indentLevel++;
    }
    // return, break, continue 등으로 시작하면 다음 줄 들여쓰기 감소
    else if (
      line.startsWith('return') ||
      line.startsWith('break') ||
      line.startsWith('continue') ||
      line.startsWith('pass')
    ) {
      // 다음 줄에서 감소하도록 예약
      if (i < lines.length - 1 && !lines[i + 1].trim().endsWith(':')) {
        indentLevel = Math.max(0, indentLevel - 1);
      }
    }
  }

  return formatted.join('\n');
}

/**
 * 코드 언어를 감지
 */
function detectLanguage(code: string): string {
  const trimmed = code.trim();

  // Java 특징 (C++보다 먼저 체크)
  if (
    /public\s+class/.test(trimmed) ||
    /class\s+\w+\s+extends/.test(trimmed) ||
    /System\.out\.println/.test(trimmed) ||
    /public\s+static\s+void\s+main/.test(trimmed) ||
    /\bString\s+\w+/.test(trimmed) ||  // String 타입 (Java)
    /\bpublic\s+void/.test(trimmed) ||  // public void 메서드 (Java)
    /\bnew\s+\w+\s*\(/.test(trimmed)    // new 키워드 (Java/C++ 공통이지만 Java에서 더 흔함)
  ) {
    return 'java';
  }

  // C/C++ 특징
  if (
    /class\s+\w+/.test(trimmed) ||
    /#include/.test(trimmed) ||
    /cout\s*<</.test(trimmed) ||
    /cin\s*>>/.test(trimmed) ||
    /std::/.test(trimmed) ||
    /public:|private:|protected:/.test(trimmed) ||
    // 함수 정의 패턴 (int, void, double, float 등)
    /(int|void|double|float|char|bool|long|short)\s+\w+\s*\([^)]*\)\s*\{/.test(trimmed) ||
    // const, return 키워드
    /\bconst\s+(int|double|float|char)\b/.test(trimmed) ||
    /return\s+.*;/.test(trimmed) ||
    // for, while 루프 C 스타일
    /for\s*\(\s*\w+/.test(trimmed) ||
    /while\s*\(/.test(trimmed)
  ) {
    return 'cpp';
  }

  // Python 특징
  if (
    /def\s+\w+/.test(trimmed) ||
    /import\s+\w+/.test(trimmed) ||
    /print\(/.test(trimmed) ||
    /__init__/.test(trimmed)
  ) {
    return 'python';
  }

  // 기본값: C/C++로 가정 (방송대 문제는 대부분 C/C++)
  return 'cpp';
}

/**
 * 텍스트 내의 모든 코드 블록을 포맷팅
 */
export function formatCodeBlocks(text: string): string {
  if (!text) return text;

  // 코드 블록 패턴: ```...``` 또는 ```언어\n...\n```
  // 더 유연한 패턴: 백틱 3개 이상, 선택적 언어, 내용, 백틱 3개 이상
  const pattern = /```+(\w*)\n?([\s\S]*?)```+/g;
  
  const result = text.replace(pattern, (match, lang, code) => {
    const trimmedCode = code.trim();
    if (!trimmedCode) return match;

    // 이미 제대로 들여쓰기가 되어 있는지 확인
    // 조건: 중괄호 다음 줄이 들여쓰기되어 있는지 확인
    const lines = trimmedCode.split('\n');
    let hasProperIndent = false;
    for (let i = 0; i < lines.length - 1; i++) {
      if (lines[i].trim().endsWith('{')) {
        // 다음 줄이 들여쓰기되어 있으면 이미 포맷팅됨
        if (lines[i + 1].startsWith('  ') || lines[i + 1].startsWith('\t')) {
          hasProperIndent = true;
          break;
        }
      }
    }
    
    if (hasProperIndent) {
      return match; // 이미 포맷팅되어 있음
    }

    // 언어 감지
    const language = lang || detectLanguage(trimmedCode);

    // 언어별 포맷팅
    let formatted = trimmedCode;
    switch (language.toLowerCase()) {
      case 'cpp':
      case 'c++':
      case 'c':
        formatted = formatCppCode(trimmedCode);
        break;
      case 'java':
        formatted = formatJavaCode(trimmedCode);
        break;
      case 'python':
      case 'py':
        formatted = formatPythonCode(trimmedCode);
        break;
      default:
        return match;
    }

    return `\`\`\`${lang}\n${formatted}\n\`\`\``;
  });

  return result;
}
