// Trust-but-verify for the OPC UA server, same spirit as dbcheck.js:
// connect exactly like UaExpert would, read the board's values, print them, leave.
// Run it twice a few seconds apart; ChipTemperatureC static at 0 or a stale
// LastReadingAt means the desk is up but the MQTT side is not feeding it.
// Online is the board's MQTT birth/last-will liveness: true while the board holds
// the broker connection, false after its will fires (unplug it and re-read to see the flip).
import { OPCUAClient, AttributeIds } from "node-opcua";

const client = OPCUAClient.create({ endpointMustExist: false });
await client.connect("opc.tcp://localhost:4840");
const session = await client.createSession();

for (const id of [
  "ns=1;s=ChipTemperatureC",
  "ns=1;s=AccelX",
  "ns=1;s=AccelY",
  "ns=1;s=AccelZ",
  "ns=1;s=LastReadingAt",
  "ns=1;s=Online",
]) {
  const result = await session.read({ nodeId: id, attributeId: AttributeIds.Value });
  console.log(id + "  ->  " + result.value.value + "  (status: " + result.statusCode.name + ")");
}

await session.close();
await client.disconnect();
