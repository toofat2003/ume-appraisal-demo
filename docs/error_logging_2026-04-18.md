# Error Logging Notes

## What is logged

- API failures in `/api/appraisal`
- History API failures in `/api/history`
- Partial image-analysis failures during appraisal requests
- Browser runtime errors via `window.error`
- Browser promise rejections via `window.unhandledrejection`

## Storage

- Supabase table: `public.app_error_events`

## Useful columns

- `id`: error event id returned to the client as `errorId` when available
- `request_id`: groups multiple server-side events from the same API request
- `severity`: `error` or `warning`
- `source`: logical emitter such as `api.appraisal` or `window.error`
- `route`: route where the event was captured
- `message`, `error_name`, `stack`
- `client_session_id`: anonymous browser session id for correlating reports
- `metadata`: request details such as image count, mime types, slot labels, and debug payloads

## How to inspect

Example query:

```sql
select
  created_at,
  id,
  request_id,
  severity,
  source,
  route,
  message
from public.app_error_events
order by created_at desc
limit 100;
```
