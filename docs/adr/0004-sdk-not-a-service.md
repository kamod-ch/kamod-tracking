# 4. An SDK repository is not a hosted service

This repo ships a library. Apps embed the collector (`createIngestHandler`) in their own process.

A separate production tracking service, dashboard host, or Kafka/Redis/ClickHouse cluster is not required to use the SDK. Do not add empty hosting or dashboard projects here.
