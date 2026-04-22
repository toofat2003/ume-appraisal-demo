# Ume Appraisal Demo

Standalone mock app for the Ume plan. The appraisal flow can use Gemini 3 image
understanding or Google Cloud Vision Web Detection for image-to-name candidates,
then eBay Browse text search for price references. If neither is configured, it
falls back to the existing eBay `searchByImage` flow.

## Required environment variables

- `EBAY_CLIENT_ID`
- `EBAY_CLIENT_SECRET`
- `EBAY_MARKETPLACE_ID` (default: `EBAY_US`)
- `EBAY_ENV` (default: `production`)
- `GOOGLE_CLOUD_VISION_API_KEY` (optional; enables Google Vision image identification)
- `GEMINI_API_KEY` (optional; enables Gemini image identification)
- `GEMINI_MODEL` (optional; default: `gemini-3-pro-preview`)
- `APPRAISAL_IMAGE_PROVIDER` (optional; `auto`, `gemini`, `google-vision`, or `ebay-image`)

## Commands

```bash
/opt/homebrew/bin/npm install
/opt/homebrew/bin/npm run dev -- --hostname 0.0.0.0 --port 3001
```
