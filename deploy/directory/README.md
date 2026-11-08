# Flight3d Multiplayer Room Directory Service

Cloudflare Workers + D1 implementation of the `/v1/rooms` directory service.

## API Endpoints

- `POST /v1/rooms`: Register a public room. Returns secret lease `token`.
- `POST /v1/rooms/:id/heartbeat`: Send periodic heartbeat (every 15s) using `Authorization: Bearer <token>` or JSON `{ token: "..." }`. Extends expiration to 45s from current time.
- `DELETE /v1/rooms/:id`: Remove room upon intentional exit.
- `GET /v1/rooms`: List currently active (unexpired) public rooms. Filter by `?protocol=2&flight=1`.

## Local Testing & Development

The repository includes a fully-tested in-memory directory store `MemoryRoomDirectoryStore` in `src/multiplayer/roomDirectory.js` that runs identically without needing Cloudflare infrastructure.
