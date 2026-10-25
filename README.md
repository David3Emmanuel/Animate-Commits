# animate-commits

Animate a git commit — or a range of commits — as if it were being written in VS Code, using your
current VS Code theme.

```bash
pnpm install
pnpm build
node dist/cli.js doctor
```

Requires Node 20+, git, and a local VS Code installation. Rendering MP4 also needs ffmpeg and a
Chromium-based browser. See `node dist/cli.js doctor` for what is missing.
