# Gemini radio audition

Generate two short English departure transmissions with distinct controller and
pilot voices, retaining clean WAVs and radio-band filtered/compressed WAVs:

```sh
node scripts/sample-gemini-radio.mjs --dry-run
# Set GEMINI_API_KEY securely in your terminal environment first.
node scripts/sample-gemini-radio.mjs
```

Requires Node 22 and FFmpeg. Output defaults to `.cache/gemini-radio/`;
`GEMINI_SAMPLE_DIR` overrides it. The default model is
`gemini-2.5-flash-preview-tts`; `GEMINI_TTS_MODEL` can select a compatible
GenerateContent TTS model. It makes two sequential requests without retries or
provider fallback. Free-tier eligibility and quotas belong to the Google project;
the API request cannot force free-tier billing.

The key stays in the generation process, never in browser assets. This audition
does not replace the existing departure clips. Listen to both versions before
regenerating all scenario audio. Radio processing currently adds band limiting
and compression; it does not add static or push-to-talk clicks.

References: [speech generation](https://ai.google.dev/gemini-api/docs/generate-content/speech-generation),
[pricing](https://ai.google.dev/gemini-api/docs/pricing).

## Full departure assets

After approving the audition, regenerate all eight bundled stage clips with:

```sh
node scripts/build-gemini-departure-radio.mjs
```

The full generator defaults to `gemini-3.1-flash-tts-preview`; set
`GEMINI_TTS_MODEL=gemini-2.5-flash-preview-tts` to use the earlier model.
Both use the same radio processing. Charon voices the
pilot, Fenrir the ground crew, and Kore the controllers. Exchanges use at most
two speakers per request; the three-speaker gate exchange is split into two
requests. Requests are spaced at least 22 seconds apart. Successful clean WAVs
are cached by model and request hash in `.cache/gemini-departure/`, so rerunning
after a quota failure reuses completed synthesis. No retries or paid fallback
occur. Public assets and their provenance manifest are replaced only once all
stages succeed. Generated clean takes stay local for comparison. The legacy
`build-departure-radio.mjs` remains an explicit Flite alternative; running it
overwrites the Gemini clips with Flite output.

When the local audition manifest exactly matches the clearance transcript,
voices and model, the generator reuses those approved clean takes for the
clearance stage instead of making another synthesis request.
