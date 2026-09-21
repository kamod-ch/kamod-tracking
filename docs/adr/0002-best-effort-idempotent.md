# 2. Best-effort delivery, idempotent storage

Browser delivery is **best effort** with at most three send attempts. The SDK does not promise exactly-once delivery or a bot-free dataset.

The store **accepts an event id once**. A retry with the same id is treated as success and does not insert a second row. First write wins.
