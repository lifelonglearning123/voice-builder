# Marketing audio samples

The marketing pages reference these files directly:

- `electrical.wav` — electrical-job booking (homepage hero + `/industries` trades card)
- `estate.wav` — estate-agent viewing booked (homepage hero + `/industries` estate card)
- `ecommerce-support.wav` — Catnip ecommerce customer support (homepage hero)
- `cold-call-filter.wav` — AI filtering an unsolicited sales call (homepage hero)

Industries without a sample (plumbing, dental, law, beauty, vet, agency, fitness)
fall back to a "Sample call · coming soon" label on `/industries`. Drop a matching
file in here and add an `audioSrc` to that industry in `app/industries/page.tsx`
to light the Listen link up.

## Recording guidance

- 60–120 seconds each is the sweet spot — long enough to demonstrate competence,
  short enough to hold attention.
- Set the scene quickly: "A customer rings at 6:42pm with a burst pipe."
- Show the AI handling something specific the visitor can imagine their own
  business needing.
- MP3 (96–128 kbps, mono) is preferred for file size; .wav is fine if that's
  what comes off the recorder.
