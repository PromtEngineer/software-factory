# tinylinks

A tiny URL shortener: a small library and an HTTP server built on `node:http`, with no framework.

```bash
npm install
npm test
npm start   # listens on :3000
```

## API

- `POST /links` with `{"url": "https://..."}` creates a short link and returns it (201).
- `GET /:slug` redirects to the stored URL (302) and counts a click.
- `GET /stats/:slug` returns `{slug, url, clicks}`.
