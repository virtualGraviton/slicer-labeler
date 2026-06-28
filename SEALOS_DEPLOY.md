# Sealos deployment

`slicer-labeler` can run as a single-container Sealos app. The app image contains only the UI and API server; dataset files should live on a persistent volume.

## Container

- Build context: `slicer-labeler/`
- Dockerfile: `slicer-labeler/Dockerfile`
- Port: `3000`
- Start command: `node server/server.mjs`

## Persistent volume layout

Mount a Sealos persistent volume at `/data`. The default container environment expects:

```text
/data/dataset/
  output/
    asr_opt/
      slicer_opt.list
    slicer_opt/
      *.wav
```

The list file should keep the existing relative paths:

```text
output/slicer_opt/example.wav|speaker|EN|Text
```

Quality results are stored in:

```text
/data/dataset/.slicer-labeler/quality-cache.json
```

## Environment variables

Required:

```text
LABELER_DATA_ROOT=/data/dataset
DEEPSEEK_API_KEY=your_api_key
```

Optional:

```text
PORT=3000
HOST=0.0.0.0
LABELER_LIST_PATH=/data/dataset/output/asr_opt/slicer_opt.list
LABELER_CACHE_PATH=/data/dataset/.slicer-labeler/quality-cache.json
DEEPSEEK_MODEL=deepseek-v4-flash
DEEPSEEK_API_URL=https://api.deepseek.com/chat/completions
```

## Local production check

```bash
npm run build
LABELER_DATA_ROOT=.. npm start
```

On Windows PowerShell:

```powershell
$env:LABELER_DATA_ROOT='..'
npm start
```

Health check:

```text
GET /api/health
```

## Notes

- Keep replicas at `1`; the app writes `slicer_opt.list`, audio files, and `quality-cache.json` directly.
- The image installs `ffmpeg` and `ffprobe` because quality checks, split, and merge depend on them.
- Do not bake API keys or dataset files into the image. Use Sealos environment variables and persistent volumes instead.
