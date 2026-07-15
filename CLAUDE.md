# CLAUDE.md

Guidance for working in this repo.

## What this is

A small industrial-IoT telemetry pipeline. Sensor readings from an ESP32-S3 board flow over
MQTT into a C#/.NET service that stores them in SQLite, and the same readings are exposed
through an OPC UA server that standard industrial clients (like UaExpert) can browse. See
`README.md` for the full walkthrough and architecture.

## Running the stack

1. Broker: `docker compose up -d` (Docker Desktop must be running)
2. Bridge: `node bridge/bridge.ts` (Node 22.6+ runs TypeScript directly, no build step)
3. Historian: `dotnet run --project historian`
4. OPC UA server: `node opcua/server.ts`

Verify end to end: `node scripts/dbcheck.js` (row count, duplicate check, and last publish
times straight from `historian/plantfloor.db`) and `node scripts/opcuacheck.ts` (reads live
values off the OPC UA server the way UaExpert would).

Message shapes are defined as JSON Schema in `schemas/messages.schema.json`. The OPC UA server
validates every incoming message against them (`validate.js`) and rejects a wrong shape (logs
`REJECTED ...`) rather than serving `undefined`. Check the guard alone with `node validate.js`.

## Gotchas learned the hard way

- A container with `restart: unless-stopped` does NOT come back after Docker Desktop shuts down
  cleanly ("Exited (0)"). Run `docker compose up -d` after any Docker restart.
- mqtt.js re-fires its `connect` event after every silent auto-reconnect. Never start a polling
  loop inside that handler; each firing stacks another loop (see comment in `bridge/bridge.ts`).
- Logs can lie: mqtt.js queues publishes while the broker is down and still logs success.
  Verify at the destination (`scripts/dbcheck.js`), not the source's logs.
- The board's temperature endpoint reports CHIP temperature, not room temperature. Label it
  honestly in every doc and demo.
