# 0020. AgentUX Command runs its workflows on PostgreSQL, with NATS for delivery, and is written in Rust

- **Status:** Accepted; amends [0014](0014-installation-profiles-and-platform-services.md); extends [0003](0003-workflow-engine.md) and [0006](0006-rust-and-tauri.md) to the Command server
- **Date:** 2026-10-22

## Context

[0014](0014-installation-profiles-and-platform-services.md) listed the Command server's stack as PostgreSQL, Temporal, NATS and object storage, and the deploy bundle ships a Temporal container. No Command code ever used Temporal or NATS: the server keeps its state in PostgreSQL (node enrollment, the Office event log and projection, approval idempotency) and its node registry in memory.

Command's own workflows are still ahead: missions that span hours or days, steps that wait for an operator's approval, retries while a node is offline, schedules, and nothing lost when Command restarts. [0003](0003-workflow-engine.md) chose an embedded state machine over Temporal for agentuxd and asked to revisit the choice at server scale. This is that revisit.

Command is now written in Rust (agentux-command#25), like agentuxd and the node gateway ([0006](0006-rust-and-tauri.md)), so that the AUXP types and the enrollment formats can be shared between the node and the server. Temporal's SDK for Rust is not one of its supported, general-availability SDKs.

## Decision

- **PostgreSQL is the source of truth for Command's workflows.** A mission and each of its steps are rows with an explicit state; every transition is one transaction that also appends to the event log, as agentuxd does in SQLite. Waits (an approval, a node coming back) are states with a deadline; retries and schedules are a `run_at` column. Workers claim due work with `SELECT … FOR UPDATE SKIP LOCKED`, so any number of workers and Command replicas share the queue safely. Steps that act on a node go through AUXP commands, which are idempotent by `commandId`.
- **Messages leave through an outbox.** A transition that must be announced writes the message to an outbox table in the same transaction. A publisher sends outbox rows and marks them sent: delivery is at least once, and consumers already deduplicate by `eventId`. No code writes to the database and publishes separately.
- **NATS delivers; it never decides.** It wakes workers when work is due, fans events out to live views (Office, the fleet console), and, once Command runs as several replicas, routes a command to the replica that holds the node's connection (`node.<id>.commands`). Losing a NATS message only delays work: workers also poll on a slow timer, and live views reload from PostgreSQL on reconnect.
- **Start without NATS.** While Command runs as one instance, PostgreSQL's `LISTEN/NOTIFY` wakes the workers. NATS comes in, behind the same outbox, when Command needs several replicas or live updates at scale. Nothing about state changes when it does.
- **Temporal leaves the Command stack.** Its Quadlet unit leaves the deploy bundle; the bundle keeps PostgreSQL, NATS and object storage. This amends [0014](0014-installation-profiles-and-platform-services.md)'s list of server dependencies; everything else in 0014 stands.

## Consequences

- One database to operate, back up and restore holds every piece of state. The bundle loses a service and Temporal's own schema.
- Command owns retry, timeout and resume logic, as agentuxd does. Workflow versioning is ours too: a state machine changes through migrations, and in-flight missions must stay readable by the new code.
- Operators get no workflow history UI from a third party; the event log is the history, and the Office and console show it.
- The same patterns run on the node (SQLite) and the server (PostgreSQL), which keeps one mental model across AgentUX.
- Revisit this ADR if missions need long, branching workflows with replay-based versioning, or if hand-written retry and timeout logic grows beyond a module.

## Alternatives considered

- **Temporal** — the reference durable-execution engine, but a second stateful service with its own database, and no generally available Rust SDK. It was planned, never used.
- **Restate** — durable execution with an official Rust SDK; the natural candidate if the revisit condition above is met. Its licence and operating model need an evaluation first, and it adds a service.
- **NATS JetStream as the workflow store** — durable streams and a key-value store, but no timers, waits or step orchestration: those would still be our code, without SQL transactions spanning state and events.
- **Hatchet, Inngest, DBOS** — durable workflows built on PostgreSQL or similar, but without Rust SDKs.
- **Keep Command in Go** — Go has Temporal's mature SDK and simpler networking code. Without Temporal, that advantage is gone, and Go would duplicate the AUXP and enrollment code the Rust node gateway already has.
