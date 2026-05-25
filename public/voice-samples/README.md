# Voice samples

This folder is served at `/voice-samples/...` by Next.js. **You normally don't need to put anything here** — all four wizard voices are now standard ElevenLabs voices, synthesised on demand by `/api/voice-preview` and cached server-side after the first hit.

## The four voices

| Voice ID                | UI label |
| ----------------------- | -------- |
| `n3Vun1rdyiQUF5EqCtmC`  | Female 1 |
| `Gv42yFG3G6CHLsU5y8g6`  | Female 2 |
| `NFG5qt843uXKj4pFvR7C`  | Male 1   |
| `Fahco4VZzobUeiPqni1S`  | Male 2   |

Set `ELEVENLABS_API_KEY` in `.env.local` and previews work for all four.

## When to drop an MP3 here

`/api/voice-preview` checks `public/voice-samples/<voice_id>.mp3` **before** calling ElevenLabs. If a file exists, it's served directly (zero latency, no API quota used). Useful if:

- You want a hand-picked recording rather than a fresh synth each time
- You hit ElevenLabs quota / outage and need a fallback
- You added a Retell-internal custom voice ID that ElevenLabs's TTS API won't accept

Save the file as `<voice_id>.mp3` — exact match, case-sensitive.

## Recording one manually

Use this sample line for consistency with the live-synth fallback:

> *"Hi, this is a sample of my voice. I can answer questions, take messages, and handle bookings — just say what you need."*
