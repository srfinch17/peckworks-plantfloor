// The bridge: every few seconds, ask the matrix board for its sensor readings
// over plain HTTP, then pin each reading to the MQTT bulletin board (the broker).
// Night 2 replaces this with the board publishing for itself; then this file retires.

import mqtt from "mqtt";

const BOARD_URL = "http://esp32matrix.local";  // the board's web address on our network
const BROKER_URL = "mqtt://localhost:1883";    // Mosquitto, running in Docker on this PC
const POLL_MS = 3000;                          // how often we ask the board (milliseconds)

const client = mqtt.connect(BROKER_URL);

async function readAndPublish() {
  try {
    const tempResponse = await fetch(BOARD_URL + "/api/sensors/temperature");
    const temp = await tempResponse.json();

    const accelResponse = await fetch(BOARD_URL + "/api/sensors/accelerometer");
    const accel = await accelResponse.json();

    const stamp = new Date().toISOString();

    client.publish(
      "plantfloor/matrix/temperature",
      JSON.stringify({ celsius: temp.celsius, ts: stamp }),
      { retain: true }
    );
    client.publish(
      "plantfloor/matrix/accelerometer",
      JSON.stringify({ ax: accel.ax, ay: accel.ay, az: accel.az, ts: stamp }),
      { retain: true }
    );

    console.log(stamp + "  published temp=" + temp.celsius + "C  accel x=" + accel.ax);
  } catch (err) {
    // Board napping or WiFi hiccup: log it and let the next poll try again.
    console.log("board read failed, will retry: " + err);
  }
}

// "connect" fires again after every silent auto-reconnect, so never start the
// polling loop inside it: each firing would stack another loop and multiply
// the publish rate. Log only.
client.on("connect", () => {
  console.log("connected to broker at " + BROKER_URL);
});

// One loop, started exactly once. If the broker is briefly down, the library
// queues the publishes and flushes them on reconnect.
readAndPublish();                      // once right away
setInterval(readAndPublish, POLL_MS);  // then every 3 seconds, forever
