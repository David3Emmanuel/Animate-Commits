export function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

export function shortenPath(path: string, max = 48): string {
  if (path.length <= max) return path;
  const parts = path.split(/[\\/]/);
  let out = parts[parts.length - 1] ?? path;
  for (let i = parts.length - 2; i >= 0; i--) {
    out = `${parts[i]}/${out}`;
    if (out.length > max) break;
  }
  return out.length > max ? `…${out.slice(out.length - max + 1)}` : out;
}
