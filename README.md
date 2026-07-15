# plantfloor

A small but real industrial-IoT pipeline running on one PC and one ESP32-S3 LED matrix
board, built as a hands-on lab for the two protocols factories actually use: MQTT and
OPC UA.

**Showcase site: https://srfinch17.github.io/peckworks-plantfloor/**

## Data flow

```
ESP32-S3 matrix board (firmware MQTT publisher, off by default)
        |
        |  publishes every 3 s (retained, QoS 0)
        |  + a birth/last-will liveness pair on plantfloor/status/matrix
        v
Mosquitto broker (Docker, port 1883)
        |                          |
        | subscribes               | subscribes
        v                          v
historian/ (C# + SQLite)      opcua/server.ts (port 4840)
every message -> a row        latest values + Online liveness
(plantfloor.db)               as OPC UA nodes for any client
```

The board publishes for itself: the publisher lives in its firmware
([mqtt_publisher.ino](https://github.com/srfinch17/peckworks-esp32s3matrix/blob/main/esp32_matrix_webserver/mqtt_publisher.ino)
in [peckworks-esp32s3matrix](https://github.com/srfinch17/peckworks-esp32s3matrix)),
enabled from the board's web-UI settings. A TypeScript bridge (`bridge/bridge.ts`) that
polls the board's HTTP API and publishes the identical topics remains as a fallback for a
board without that firmware. Run exactly one publisher at a time: both write the same
topics, so running both stores every reading twice.

Two consumers, two jobs: the historian keeps history, the OPC UA server answers
"what is the value right now" to standard industrial clients like UaExpert. Neither
knows the other exists; the broker decouples everything.

## Running the stack

1. Broker: `docker compose up -d` (Docker Desktop must be running)
2. Data source, pick ONE:
   - default: the board itself. Enable MQTT in the board's web-UI settings
     (broker host = this PC's LAN IP, port 1883).
   - fallback: `node bridge/bridge.ts` (Node 22.6+ runs TypeScript directly, no build step)
3. Historian: `dotnet run --project historian`
4. OPC UA server: `node opcua/server.ts`

## Message contracts

Payload shapes are written down as JSON Schema in `schemas/messages.schema.json`, one
schema per topic. The OPC UA server validates every incoming message (`validate.js`) and
rejects a wrong shape (logged as `REJECTED ...`) instead of silently serving `undefined`;
the historian deliberately stores raw, so the archive keeps whatever was actually sent.
The firmware and this pipeline live in different repositories and agree only on these
shapes; the schema file is the handshake between them.

## Verifying (trust the destination, not the logs)

- `node scripts/dbcheck.js`: row count, duplicate check, and last publish times read
  straight out of `historian/plantfloor.db`.
- `node scripts/opcuacheck.ts`: connects to the OPC UA server the way a real client
  would and reads live values back, including `Online`.
- `node validate.js`: self-checks the message-shape guard (a valid message passes, a
  wrong shape is caught with the missing fields named).

## OPC UA in UaExpert

The server at `opc.tcp://localhost:4840` exposes the board under
`Objects > MatrixBoard`: `ChipTemperatureC`, `AccelX`, `AccelY`, `AccelZ`,
`LastReadingAt`, and `Online` (board liveness from the MQTT birth/last-will on
`plantfloor/status/matrix`). With the firmware publisher holding the broker connection,
`Online` reads `true`; pull the board's power and, roughly 45 seconds later (the
keepalive window), the broker publishes the board's last will and `Online` flips to
`false` while the sensor nodes freeze at their last-known values. Verified live, both
directions. The screenshot below is the 2026-07-14 browse of the first five nodes;
`Online` was added to the server afterward and appears on the next rebrowse. Browsed
live with UaExpert, values updating as the physical board is moved:

![UaExpert browsing live MatrixBoard values](docs/uaexpert-live-values.png)

Honest labeling note: `ChipTemperatureC` is the temperature of the ESP32's own
silicon, not the room. The board has no ambient temperature sensor.
