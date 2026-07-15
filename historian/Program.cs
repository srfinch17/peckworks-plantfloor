// The baby historian: subscribe to the plantfloor topics on the broker and
// file every message that arrives as a row in a SQLite database (plantfloor.db).
// It never talks to the board; it only listens to the broker.

using Microsoft.Data.Sqlite;
using MQTTnet;

const string BrokerHost = "localhost";
const string TopicFilter = "plantfloor/matrix/#";  // # = everything under plantfloor/matrix

// Open (or create) the database file and make sure our table exists.
// Print the FULL path up front: a relative path silently follows the launch folder,
// and a log that only says "plantfloor.db" can't be caught lying about where.
var dbPath = Path.GetFullPath("plantfloor.db");
Console.WriteLine($"database file: {dbPath}");
var db = new SqliteConnection($"Data Source={dbPath}");
db.Open();
using (var create = db.CreateCommand())
{
    create.CommandText = """
        CREATE TABLE IF NOT EXISTS readings (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            topic       TEXT NOT NULL,
            payload     TEXT NOT NULL,
            received_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
        """;
    create.ExecuteNonQuery();
}

var client = new MqttClientFactory().CreateMqttClient();
var options = new MqttClientOptionsBuilder().WithTcpServer(BrokerHost).Build();

// Runs once for every message the broker hands us.
client.ApplicationMessageReceivedAsync += e =>
{
    var topic = e.ApplicationMessage.Topic;
    var payload = e.ApplicationMessage.ConvertPayloadToString();

    using var insert = db.CreateCommand();
    insert.CommandText = "INSERT INTO readings (topic, payload) VALUES ($topic, $payload)";
    insert.Parameters.AddWithValue("$topic", topic);
    insert.Parameters.AddWithValue("$payload", payload);
    insert.ExecuteNonQuery();

    Console.WriteLine($"saved  {topic}  {payload}");
    return Task.CompletedTask;
};

// One loop keeps us connected: the first connect, and reconnects after any drop
// (broker restarts, Docker closing overnight). It also keeps the program alive;
// all real work happens in the message handler above.
while (true)
{
    if (!client.IsConnected)
    {
        try
        {
            await client.ConnectAsync(options);
            await client.SubscribeAsync(TopicFilter);
            Console.WriteLine($"connected: subscribed to {TopicFilter}, writing to plantfloor.db (Ctrl+C to stop)");
        }
        catch
        {
            Console.WriteLine("broker not reachable, retrying in 5s...");
        }
    }
    await Task.Delay(TimeSpan.FromSeconds(5));
}
