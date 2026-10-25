function globToRegExp(pattern: string): RegExp {
  let regex = '';
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i]!;
    if (char === '*') {
      if (pattern[i + 1] === '*') {
        i++;
        if (pattern[i + 1] === '/') {
          i++;
          regex += '(?:.*/)?';
        } else {
          regex += '.*';
        }
      } else {
        regex += '[^/]*';
      }
    } else if (char === '?') {
      regex += '[^/]';
    } else if ('\\^$+.|()[]{}'.includes(char)) {
      regex += `\\${char}`;
    } else {
      regex += char;
    }
  }
  return new RegExp(`^${regex}$`, 'i');
}

export function matchesIgnore(path: string, patterns: string[]): boolean {
  for (const raw of patterns) {
    const pattern = raw.trim().replace(/\\/g, '/');
    if (!pattern) continue;
    if (!pattern.includes('/')) {
      const base = path.split('/').pop() ?? path;
      if (globToRegExp(pattern).test(base)) return true;
    } else if (globToRegExp(pattern.replace(/^\.\//, '')).test(path)) {
      return true;
    }
  }
  return false;
}
