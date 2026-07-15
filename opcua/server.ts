// The OPC UA front desk: listens to the MQTT bulletin board on one side and
// answers OPC UA visitors (UaExpert, or any SCADA package) on the other.
// It keeps only the LATEST value of each reading; history stays the
// historian's job. Rip this file out and MQTT carries on unaffected.

import mqtt from "mqtt";
import { OPCUAServer, Variant, DataType } from "node-opcua";

const BROKER_URL = "mqtt://localhost:1883";  // Mosquitto, same as the bridge
const OPCUA_PORT = 4840;                     // the standard OPC UA port

// The clerk's notepad: newest reading of each sensor. MQTT writes it,
// OPC UA reads it. Zeros until the first (retained) message lands.
const latest = {
  chipTempC: 0,   // CHIP temperature: the ESP32's own silicon, not the room
  ax: 0,
  ay: 0,
  az: 0,
  ts: "",         // timestamp the bridge stamped on the newest reading
  online: false,  // board liveness from plantfloor/status/matrix (retained birth/last-will)
};

// ---- MQTT side: keep the notepad fresh -------------------------------

const client = mqtt.connect(BROKER_URL);

// "connect" re-fires after every silent auto-reconnect. Re-subscribing is
// harmless (the broker just refreshes it); starting a loop here would not
// be (see bridge.ts). Subscribe and log only.
client.on("connect", () => {
  client.subscribe("plantfloor/matrix/#");
  client.subscribe("plantfloor/status/matrix");  // board liveness (off the data subtree on purpose)
  console.log("connected to broker at " + BROKER_URL);
});

client.on("message", (topic, payload) => {
  try {
    const data = JSON.parse(payload.toString());
    // The status topic carries the board's birth ({"online":true}) and last will
    // ({"online":false}). It has NO ts, so handle it and return before the ts line below,
    // or it would blank latest.ts.
    if (topic === "plantfloor/status/matrix") {
      latest.online = data.online === true;
      return;
    }
    if (topic === "plantfloor/matrix/temperature") {
      latest.chipTempC = data.celsius;
    } else if (topic === "plantfloor/matrix/accelerometer") {
      latest.ax = data.ax;
      latest.ay = data.ay;
      latest.az = data.az;
    }
    latest.ts = data.ts;
  } catch (err) {
    // A malformed payload shouldn't crash the desk: note it and move on.
    console.log("ignored unparseable message on " + topic + ": " + err);
  }
});

// ---- OPC UA side: the front desk itself -------------------------------

const server = new OPCUAServer({
  port: OPCUA_PORT,
  buildInfo: {
    productName: "plantfloor-opcua",
    manufacturerName: "plantfloor",
  },
});

await server.initialize();

// The address space is the desk's catalog: the tree of folders and values
// a visitor sees when they browse us. We add one folder for the board.
const addressSpace = server.engine.addressSpace;
const namespace = addressSpace.getOwnNamespace();

const board = namespace.addObject({
  organizedBy: addressSpace.rootFolder.objects,
  browseName: "MatrixBoard",
});

// Register one read-only number under the MatrixBoard folder. Instead of
// storing a value, we hand OPC UA a getter: every time a visitor asks,
// it calls the getter and answers with whatever is on the notepad NOW.
function addReading(name: string, description: string, read: () => number) {
  namespace.addVariable({
    componentOf: board,
    browseName: name,
    nodeId: "s=" + name,  // a stable, human-readable address for this value
    description,
    dataType: "Double",
    minimumSamplingInterval: 1000,  // check the notepad at most once a second; the data only changes every 3
    value: { get: () => new Variant({ dataType: DataType.Double, value: read() }) },
  });
}

addReading("ChipTemperatureC", "ESP32 chip temperature in Celsius (the silicon itself, not the room)", () => latest.chipTempC);
addReading("AccelX", "accelerometer X axis in g", () => latest.ax);
addReading("AccelY", "accelerometer Y axis in g", () => latest.ay);
addReading("AccelZ", "accelerometer Z axis in g", () => latest.az);

namespace.addVariable({
  componentOf: board,
  browseName: "LastReadingAt",
  nodeId: "s=LastReadingAt",
  description: "timestamp the bridge stamped on the newest reading",
  dataType: "String",
  minimumSamplingInterval: 1000,
  value: { get: () => new Variant({ dataType: DataType.String, value: latest.ts }) },
});

// Board liveness, straight off the MQTT last-will/birth. True from the retained birth message
// the board publishes on connect; flips to false when the broker fires the board's last will
// after its connection drops (power loss, WiFi drop, crash). This is what makes "unplug the
// board and watch it go offline" visible in UaExpert. Only meaningful once the firmware
// publisher holds the broker connection (the bridge cannot leave a will for the board).
namespace.addVariable({
  componentOf: board,
  browseName: "Online",
  nodeId: "s=Online",
  description: "board connection liveness from the MQTT birth/last-will on plantfloor/status/matrix (not a claim the hardware is healthy, only that the broker is hearing from it)",
  dataType: "Boolean",
  minimumSamplingInterval: 1000,
  value: { get: () => new Variant({ dataType: DataType.Boolean, value: latest.online }) },
});

await server.start();
console.log("OPC UA front desk open at " + server.getEndpointUrl());
console.log("point UaExpert at opc.tcp://localhost:" + OPCUA_PORT + " and browse Objects > MatrixBoard");
