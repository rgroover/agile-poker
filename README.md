# Common Ground

A small, self-hosted planning poker app focused on the planning poker interaction after clicking **Start a Session** on [Pointing Poker](https://www.pointingpoker.com/) session: choose an estimate, see who is ready, reveal the votes, discuss, and repeat. Built with **.NET 10, ASP.NET Core SignalR, and plain HTML/CSS/JavaScript**. One container, no database, no accounts, no runtime CDN dependencies.

## Run with Docker

```sh
docker compose up --build -d
```

Open **http://localhost:8080**. Share your server's reachable URL with teammates. `localhost` only works on your own computer. To use a different host port, change the left side of `8080:8080` in `compose.yaml`.

Or use Docker directly:

```sh
docker build -t common-ground .
docker run --rm -p 8080:8080 --name common-ground common-ground
```

The multi-stage Dockerfile compiles with the .NET 10 SDK and runs on the smaller ASP.NET 10 image as its non-root application user. Compose additionally uses a read-only filesystem and a small temporary filesystem. There are no volumes or other services.

## Use it

1. Enter your name and click **Start a Session** to open a planning poker room. Share its invite link or session ID with your teammates; they can follow the link or use **Join session**.
2. Choose a card. Clicking your selected card clears it; choosing another changes your estimate before reveal.
3. The host reveals the cards. Discuss the votes and distribution together.
4. Click **Next round** to immediately clear the cards and continue estimating. Use **Vote again** to repeat the current round. Topics are optional and can be added separately before voting.

The entry screen defaults to **Start a Session**, with a separate **Join session** tab for teammates. The session opens directly onto the voting deck, player readiness, and reveal controls, without a marketing page or workspace navigation.

Features include:

- Live participant presence, voting status, and spectator mode.
- Fibonacci, modified Fibonacci, T-shirt, and powers-of-two decks, with unsure and coffee-break cards.
- Host controls for topics, reveal, revoting, next round, deck, and optional automatic reveal.
- Shared one-, two-, or five-minute discussion timers. Timer expiration is a visual prompt; it does not force a reveal.
- Vote distributions, numeric average and median, round history, and CSV export.
- Automatic reconnection and refresh recovery in the same browser tab.
- Responsive layouts, keyboard controls, native accessible dialogs, and reduced-motion support.

## Memory and session behavior

**Everything on the server is in memory.** Restarting, redeploying, or stopping the container loses all rooms, participants, votes, and history. Sessions expire after **12 hours without a join, action, or disconnect**; a background task reclaims them every minute. A connected but idle tab does not keep a room alive forever. Export CSV before ending a session if you need a record.

Limits: 1,000 rooms per process, 50 identities per room, and the latest 100 revealed round results. Offline participants keep their seat and vote until they return, explicitly leave, or the room expires. Automatic reveal counts online players; manual reveal includes votes already cast by offline players. The team roster indicates who is away.

The original host receives a random secret token when creating a room. Each joining participant gets their own token. Tokens stay in `sessionStorage` and are never included in invite URLs. A refresh resumes the same identity; another browser can join as a separate player. If browser storage is disabled, voting still works, but refresh recovery does not. When the host disconnects, a connected teammate takes over. A returning former host keeps their seat without taking moderation away from the current host. If everyone disconnects, the first returning participant becomes host.

Hidden votes are **redacted on the server**: other players receive only voting status until reveal, including the host. Revealed round summaries are shared with everyone in the room. Host permissions, card values, room membership, and input lengths are validated on the server.

This is an account-free team tool. Anyone with the room ID can join; room IDs are not passwords. Run **one application instance** because state is process-local. For Internet-facing use, put the container behind your HTTPS reverse proxy and pass WebSocket upgrade requests through to `/hubs/poker`. SignalR can also fall back to server-sent events or long polling. The creation endpoint has an IP-based rate limit of 15 requests per minute; behind a proxy it uses the proxy IP unless trusted forwarded-header handling is configured. Hub messages are limited to 8 KiB. `/health` returns JSON for monitoring. No telemetry or third-party web assets are loaded.

## Local development

Install a .NET 10 SDK. No Node toolchain is required to run the application:

```sh
dotnet run --project AgilePoker.csproj --urls http://localhost:8080
```

For a release build:

```sh
dotnet build -c Release
dotnet publish -c Release -o ./publish
```

Source layout:

| File | Purpose |
| --- | --- |
| `Program.cs` | HTTP pipeline, static assets, room creation, health, SignalR |
| `PokerHub.cs` | Typed hub actions and safe validation errors |
| `RoomStore.cs` | Serialized room mutations, recipient-specific snapshots, statistics, cleanup |
| `Models.cs` | Internal room state and public DTOs |
| `wwwroot/` | Self-contained browser UI and vendored SignalR client |
| `tests/` | Multi-browser integration and UI tests |

## Tests

The optional test suite uses Node 22+ and a local Chromium browser. Install test tooling, then run:

```sh
npm ci
npm test
```

Tests start their own .NET server on a free loopback port and stop it afterward. The default browser executable is `/usr/bin/chromium`. Override it when needed, for example:

```sh
CHROMIUM_PATH=/path/to/chrome npm test
```

The suite exercises real SignalR clients in isolated browser contexts: hidden vote redaction, host permissions, reveal statistics, clearing votes, reconnect identity, host handoff, spectators, deck validation, automatic reveal, history export, error handling, and mobile layout.

## Dependencies

The browser client in `wwwroot/lib/` is the official **@microsoft/signalr 10.0.0** distribution with its MIT license. It is checked in so both Docker builds and clients need no npm install or CDN. Optional test dependencies are locked in `package-lock.json`. ASP.NET Core SignalR comes from the shared .NET runtime; there are no application NuGet packages.
