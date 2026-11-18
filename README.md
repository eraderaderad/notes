# eradnotes

Personal, local-first AI note-taking and learning assistant for Windows. No account, no sync.

## Run

```
npm install
npm start            # build the UI and open the desktop app
npm run dev          # desktop app with hot reload
npm run package      # portable app in release/eradnotes-win32-x64/eradnotes.exe
```

Checks: `npm test` (backend, 44 checks), `npm run selftest` (launches the real Electron app, checks system-audio capture; pass a 16 kHz WAV path to also test transcription) and `npm run test:ai` (runs every AI feature against your local Ollama model).

## Recording

The recorder can record your **Microphone**, **System audio** (everything you hear in your headphones or speakers, e.g. an online class or video), or **Both** mixed together. System audio uses Windows loopback capture; nothing on screen is recorded. With "Both", use headphones so the speakers aren't picked up twice by the microphone.

## Local AI (Ollama)

Install Ollama, run `ollama pull llama3.1:8b`, then choose Settings → AI → Ollama. Everything stays on this PC.

## Where things live

- Your data: `Documents\eradnotes` by default (change it in Settings → Storage). It holds `eradnotes.db` (SQLite), `audio/`, `documents/`, `backups/` and `models/` (Whisper).
- `electron/`: desktop shell (window, IPC, DPAPI-encrypted API keys).
- `server/`: backend (database, Whisper worker, document extraction, AI providers, all handlers).
- `src/`: React UI (pages, editor, components).

## Privacy

- Transcription runs locally with Whisper. The speech model (~110 MB for "base") is downloaded once from huggingface.co; afterwards it works offline.
- AI features are off until you pick a provider in Settings → AI. Ollama or a local OpenAI-compatible server keeps everything on the PC. With a cloud provider (Claude, OpenAI-compatible), the text you run an AI action on is sent to that provider; audio is never sent.
