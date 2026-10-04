import type { Project } from "../types";
import type { ScenarioSpec } from "./script";

export const PROJECTS: Project[] = [
  { id: "agentux-core", name: "agentux-core", path: "~/src/agentux-core", repo: "agentux-os/agentux-core", language: "Rust" },
  { id: "ledger-api", name: "ledger-api", path: "~/src/ledger-api", repo: "northwind/ledger-api", language: "Go" },
  { id: "atlas-web", name: "atlas-web", path: "~/src/atlas-web", repo: "northwind/atlas-web", language: "TypeScript" },
  { id: "tidewater", name: "tidewater", path: "~/src/tidewater", repo: "northwind/tidewater", language: "Python" },
];

const rustChecks = [
  { name: "clippy", command: "cargo clippy --all-targets -- -D warnings" },
  { name: "test", command: "cargo test" },
];
const goChecks = [
  { name: "lint", command: "golangci-lint run ./..." },
  { name: "test", command: "go test ./..." },
];
const webChecks = [
  { name: "typecheck", command: "npm run typecheck" },
  { name: "test", command: "npm test" },
];
const pyChecks = [
  { name: "ruff", command: "ruff check ." },
  { name: "pytest", command: "pytest -q" },
];

export const SCENARIOS: ScenarioSpec[] = [
  {
    key: "core-worktree-gc",
    projectId: "agentux-core",
    issue: 41,
    title: "Garbage-collect stale worktrees on daemon start",
    slug: "worktree-gc",
    prompt: "Runs that crash leave their worktree behind under ~/.local/share/agentux/worktrees. On start, agentuxd should remove worktrees whose run is finished or unknown, and log what it removed.",
    roles: { planner: "claude-code", implementer: "claude-code", reviewer: "codex" },
    explore: {
      intro: "I'll look at how worktrees are created and where run state lives before planning.",
      search: "fn create_worktree",
      searchOutput: "src/worktree.rs:18:pub fn create_worktree(repo: &Path, run: &RunId) -> Result<PathBuf> {\nsrc/run/mod.rs:77:        let wt = worktree::create_worktree(&project.path, &run.id)?;",
      read: "src/worktree.rs",
      finding: "Worktrees are created by `git worktree add` under `worktrees_root/<run-id>` and never removed. Run status is in SQLite (`runs.status`). A startup sweep can list the directory, look up each run id, and call `git worktree remove --force` for finished or unknown runs.",
    },
    plan: [
      "Add `sweep_stale(root, store)` in src/worktree.rs",
      "Call the sweep from `Daemon::start` before accepting connections",
      "Prune git metadata with `git worktree prune`",
      "Unit test with a temp repo and fake run store",
    ],
    planApproval: true,
    implement: {
      intro: "Starting with the sweep function, then wiring it into daemon start.",
      diffs: [
        {
          path: "src/worktree.rs",
          header: "@@ -42,6 +42,24 @@ pub fn create_worktree(repo: &Path, run: &RunId) -> Result<PathBuf> {",
          body: `     Ok(path)
 }

+/// Removes worktrees whose run is finished or unknown to the store.
+pub fn sweep_stale(root: &Path, store: &RunStore) -> Result<Vec<RunId>> {
+    let mut removed = Vec::new();
+    for entry in fs::read_dir(root)? {
+        let entry = entry?;
+        let id = RunId::from(entry.file_name().to_string_lossy().as_ref());
+        let live = matches!(store.status(&id)?, Some(s) if s.is_active());
+        if !live {
+            git(&["worktree", "remove", "--force"], &entry.path())?;
+            removed.push(id);
+        }
+    }
+    git(&["worktree", "prune"], root)?;
+    Ok(removed)
+}
+`,
        },
        {
          path: "src/daemon.rs",
          header: "@@ -31,7 +31,12 @@ impl Daemon {",
          body: `     pub async fn start(config: Config) -> Result<Self> {
         let store = RunStore::open(&config.db_path)?;
-        let bus = Bus::new(config.bus.clone());
+        let removed = worktree::sweep_stale(&config.worktrees_root, &store)?;
+        if !removed.is_empty() {
+            tracing::info!(count = removed.len(), "removed stale worktrees");
+        }
+        let bus = Bus::new(config.bus.clone());
         let listener = UnixListener::bind(&config.socket)?;`,
        },
      ],
      summary: "Added `sweep_stale` and call it from `Daemon::start`; stale worktrees are removed and pruned, with a log line counting them.",
    },
    checks: rustChecks,
    gateFailure: {
      check: "test",
      output: "running 14 tests\ntest worktree::tests::sweep_removes_finished_runs ... FAILED\n\n---- worktree::tests::sweep_removes_finished_runs stdout ----\nthread panicked at src/worktree.rs:131:9:\ncalled `Result::unwrap()` on an `Err` value: fatal: '/tmp/.tmpX2a9/wt/run-7' is not a working tree\n\ntest result: FAILED. 13 passed; 1 failed",
      note: "The test creates a plain directory, not a real worktree, so `git worktree remove` fails. Directories that git doesn't know should be deleted directly instead of erroring.",
      fix: {
        path: "src/worktree.rs",
        header: "@@ -50,7 +50,11 @@ pub fn sweep_stale(root: &Path, store: &RunStore) -> Result<Vec<RunId>> {",
        body: `         let live = matches!(store.status(&id)?, Some(s) if s.is_active());
         if !live {
-            git(&["worktree", "remove", "--force"], &entry.path())?;
+            if git(&["worktree", "remove", "--force"], &entry.path()).is_err() {
+                // Not registered with git (e.g. half-created); remove the directory.
+                fs::remove_dir_all(entry.path())?;
+            }
             removed.push(id);`,
      },
    },
    review: {
      stat: " src/daemon.rs   |  7 ++++++-\n src/worktree.rs | 52 +++++++++++++++++++++++++++++++++++++++\n 2 files changed, 58 insertions(+), 1 deletion(-)",
      focus: "Reading the sweep. Logic is sound for the happy path; checking how paths are derived from directory names.",
      changes: {
        comment: "`remove_dir_all(entry.path())` follows whatever is in `worktrees_root`. A symlink placed there would make us delete its target. Please skip symlinks and only remove entries whose canonical path is inside `root`.",
        reply: "Good catch. I'll use `symlink_metadata` to skip links and assert the canonical path starts with the canonical root before removing anything.",
        fix: {
          path: "src/worktree.rs",
          header: "@@ -46,6 +46,12 @@ pub fn sweep_stale(root: &Path, store: &RunStore) -> Result<Vec<RunId>> {",
          body: `     for entry in fs::read_dir(root)? {
         let entry = entry?;
+        if entry.file_type()?.is_symlink() {
+            continue;
+        }
+        if !entry.path().canonicalize()?.starts_with(root.canonicalize()?) {
+            continue;
+        }
         let id = RunId::from(entry.file_name().to_string_lossy().as_ref());`,
        },
      },
      approve: "Looks good now: symlinks are skipped, removal is confined to the root, and the fallback is tested. Approving.",
    },
    pr: { number: 118, summary: "Opened PR #118: sweep stale worktrees on daemon start, with symlink-safe removal and tests." },
  },
  {
    key: "core-bus-turns",
    projectId: "agentux-core",
    issue: 57,
    title: "Cap turns per bus exchange",
    slug: "bus-turn-cap",
    prompt: "Enforce `bus.max_turns_per_exchange` from agentux.yaml. When two sessions exceed it, stop routing and tell both sides.",
    roles: { planner: "codex", implementer: "codex", reviewer: "claude-code" },
    explore: {
      intro: "Looking at how the bus routes messages and whether exchanges are tracked.",
      search: "struct Exchange",
      searchOutput: "src/bus/router.rs:22:pub struct Exchange {\nsrc/bus/router.rs:88:    fn route(&mut self, msg: Message) -> Result<Delivery> {",
      read: "src/bus/router.rs",
      finding: "`Exchange` already has a `turns` counter but nothing reads it. The limit is parsed into `BusConfig` but never passed to the router.",
    },
    plan: [
      "Pass `max_turns_per_exchange` into `Router::new`",
      "Reject routing when `turns >= max` with `Delivery::LimitReached`",
      "Notify both sessions and the human when the cap is hit",
      "Property test: no exchange exceeds the cap",
    ],
    implement: {
      intro: "Threading the config through first, then the check in `route`.",
      diffs: [
        {
          path: "src/bus/router.rs",
          header: "@@ -88,6 +88,14 @@ impl Router {",
          body: `     fn route(&mut self, msg: Message) -> Result<Delivery> {
         let ex = self.exchanges.entry(msg.exchange_id()).or_default();
+        if ex.turns >= self.max_turns {
+            self.notify_limit(&msg, ex.turns);
+            return Ok(Delivery::LimitReached { turns: ex.turns });
+        }
+        ex.turns += 1;
         let target = self.sessions.get(&msg.to).ok_or(BusError::UnknownTarget)?;
         target.wake(msg.as_prompt()).await?;`,
        },
      ],
      command: {
        tool: "execute",
        cmd: "cargo add --dev proptest",
        why: "I want a property test for the cap; that needs `proptest` as a dev-dependency.",
        output: "    Updating crates.io index\n      Adding proptest v1.6.0 to dev-dependencies",
      },
      summary: "The router now enforces the turn cap, returns `LimitReached`, and notifies both sessions plus the human.",
    },
    checks: rustChecks,
    question: {
      at: "review",
      text: "When an exchange hits the turn cap, should the daemon escalate to your inbox, or just drop further messages and log it?",
      options: ["Escalate to the inbox", "Drop and log"],
      context: "Escalating adds an inbox item per capped exchange; dropping keeps the inbox quiet but hides stuck agents.",
    },
    busRefusal: "turn_limit",
    review: {
      stat: " Cargo.toml          |  3 +++\n src/bus/router.rs   | 31 +++++++++++++++++++++++++++----\n tests/bus_limits.rs | 44 ++++++++++++++++++++++++++++++++++++++++++++\n 3 files changed, 74 insertions(+), 4 deletions(-)",
      focus: "The cap check is in the right place (before waking the target). The property test covers interleaved exchanges too.",
      approve: "Approved. Clean change and the property test is convincing.",
    },
    pr: { number: 121, summary: "Opened PR #121: enforce max turns per bus exchange." },
  },
  {
    key: "ledger-idempotency",
    busRefusal: "tool_denied",
    projectId: "ledger-api",
    issue: 212,
    title: "Idempotency keys for POST /transfers",
    slug: "transfer-idempotency",
    prompt: "Clients retry POST /transfers on timeouts and we get duplicate transfers. Accept an `Idempotency-Key` header and return the original response for repeats within 24h.",
    roles: { planner: "codex", implementer: "codex", reviewer: "claude-code" },
    explore: {
      intro: "Checking the transfers handler and what storage is available for keys.",
      search: "func (h \\*TransferHandler) Create",
      searchOutput: "internal/http/transfers.go:41:func (h *TransferHandler) Create(w http.ResponseWriter, r *http.Request) {",
      read: "internal/http/transfers.go",
      finding: "Handler writes directly via `h.svc.Transfer`. Postgres is the only store; a small `idempotency_keys` table with a unique key and the stored response is the simplest durable option.",
    },
    plan: [
      "Migration: `idempotency_keys(key, request_hash, status, body, created_at)`",
      "Middleware that looks up the key before the handler runs",
      "Store response after a successful transfer in the same transaction",
      "Expire keys older than 24h in the nightly job",
    ],
    planApproval: true,
    implement: {
      intro: "Migration first, then the middleware.",
      diffs: [
        {
          path: "migrations/0031_idempotency_keys.sql",
          header: "@@ -0,0 +1,8 @@",
          body: `+CREATE TABLE idempotency_keys (
+    key          text PRIMARY KEY,
+    status       int  NOT NULL,
+    body         jsonb NOT NULL,
+    created_at   timestamptz NOT NULL DEFAULT now()
+);
+CREATE INDEX idempotency_keys_created_at ON idempotency_keys (created_at);`,
        },
        {
          path: "internal/http/idempotency.go",
          header: "@@ -0,0 +1,14 @@",
          body: `+func Idempotent(store KeyStore, next http.Handler) http.Handler {
+	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
+		key := r.Header.Get("Idempotency-Key")
+		if key == "" {
+			next.ServeHTTP(w, r)
+			return
+		}
+		if saved, ok := store.Get(r.Context(), key); ok {
+			writeSaved(w, saved)
+			return
+		}
+		next.ServeHTTP(&recorder{ResponseWriter: w, key: key, store: store}, r)
+	})
+}`,
        },
      ],
      summary: "Requests with an `Idempotency-Key` now replay the stored response; new keys are recorded after a successful transfer.",
    },
    checks: goChecks,
    review: {
      stat: " internal/http/idempotency.go         | 61 +++++++++++++++++\n internal/http/router.go              |  2 +-\n migrations/0031_idempotency_keys.sql |  8 +++\n 3 files changed, 70 insertions(+), 1 deletion(-)",
      focus: "Reviewing replay semantics. Storage and middleware placement look right.",
      changes: {
        comment: "A retry with the same key but a different body silently gets the first transfer's response. Store a hash of the request body and return 422 when it differs, per the IETF idempotency-key draft.",
        reply: "Agreed. Adding `request_hash` (sha256 of the body) to the table and returning 422 on mismatch.",
        fix: {
          path: "internal/http/idempotency.go",
          header: "@@ -8,6 +8,11 @@ func Idempotent(store KeyStore, next http.Handler) http.Handler {",
          body: `-		if saved, ok := store.Get(r.Context(), key); ok {
+		hash := bodyHash(r)
+		if saved, ok := store.Get(r.Context(), key); ok {
+			if saved.RequestHash != hash {
+				http.Error(w, "idempotency key reused with a different request", http.StatusUnprocessableEntity)
+				return
+			}
 			writeSaved(w, saved)`,
        },
      },
      approve: "Hash check is in and tested. Approving.",
    },
    pr: { number: 487, summary: "Opened PR #487: idempotency keys for POST /transfers with request-hash validation." },
  },
  {
    key: "ledger-n-plus-one",
    projectId: "ledger-api",
    issue: 219,
    title: "Fix N+1 query in account statements",
    slug: "statement-n-plus-one",
    prompt: "GET /accounts/{id}/statement issues one query per transaction to load counterparties. p95 is 1.8s for busy accounts.",
    roles: { planner: "opencode", implementer: "opencode", reviewer: "antigravity" },
    explore: {
      intro: "Finding where counterparties are loaded.",
      search: "GetCounterparty",
      searchOutput: "internal/statement/build.go:57:		cp, err := b.repo.GetCounterparty(ctx, tx.CounterpartyID)\ninternal/store/counterparty.go:19:func (r *Repo) GetCounterparty(ctx context.Context, id uuid.UUID) (*Counterparty, error) {",
      read: "internal/statement/build.go",
      finding: "Confirmed: `GetCounterparty` runs inside the per-transaction loop. A single `WHERE id = ANY($1)` query keyed into a map removes the N+1.",
    },
    plan: [
      "Add `GetCounterparties(ctx, ids)` using `id = ANY($1)`",
      "Collect distinct ids before the loop and fetch once",
      "Benchmark with 5k transactions",
    ],
    implement: {
      intro: "Adding the batch query and changing the builder loop.",
      diffs: [
        {
          path: "internal/statement/build.go",
          header: "@@ -52,9 +52,13 @@ func (b *Builder) Build(ctx context.Context, acct uuid.UUID) (*Statement, error) {",
          body: `-	for _, tx := range txs {
-		cp, err := b.repo.GetCounterparty(ctx, tx.CounterpartyID)
-		if err != nil {
-			return nil, err
-		}
+	ids := distinctCounterparties(txs)
+	cps, err := b.repo.GetCounterparties(ctx, ids)
+	if err != nil {
+		return nil, err
+	}
+	for _, tx := range txs {
+		cp := cps[tx.CounterpartyID]
 		lines = append(lines, line(tx, cp))`,
        },
      ],
      summary: "Counterparties are now fetched in one query. Local benchmark: 5k transactions from 1.6s to 41ms.",
    },
    checks: goChecks,
    gateFailure: {
      check: "lint",
      output: "internal/statement/build.go:49:2: ineffectual assignment to err (ineffassign)\n	txs, err := b.repo.Transactions(ctx, acct)\n	^\n1 issues:\n* ineffassign: 1",
      note: "The `err` from `Transactions` is shadowed by the new code before being checked. Restoring the check.",
      fix: {
        path: "internal/statement/build.go",
        header: "@@ -48,6 +48,9 @@ func (b *Builder) Build(ctx context.Context, acct uuid.UUID) (*Statement, error) {",
        body: ` 	txs, err := b.repo.Transactions(ctx, acct)
+	if err != nil {
+		return nil, err
+	}
 	ids := distinctCounterparties(txs)`,
      },
    },
    review: {
      stat: " internal/statement/build.go      | 14 ++++++++-----\n internal/store/counterparty.go   | 22 ++++++++++++++++++\n internal/statement/build_test.go | 31 ++++++++++++++++++++++++++\n 3 files changed, 62 insertions(+), 5 deletions(-)",
      focus: "Checked that a missing counterparty yields nil rather than panicking; the template already handles nil. Benchmark numbers look plausible.",
      approve: "Approved. Nice win on p95.",
    },
    pr: { number: 491, summary: "Opened PR #491: batch counterparty loading in statements (N+1 removed)." },
  },
  {
    key: "atlas-palette-keys",
    projectId: "atlas-web",
    issue: 88,
    title: "Keyboard navigation for the command palette",
    slug: "palette-keyboard-nav",
    prompt: "The command palette only works with the mouse. Arrow keys should move the selection, Enter runs the command, Escape closes. Screen readers should announce the active item.",
    roles: { planner: "claude-code", implementer: "claude-code", reviewer: "codex" },
    explore: {
      intro: "Looking at the palette component and existing keyboard helpers.",
      search: "CommandPalette",
      searchOutput: "src/components/CommandPalette.tsx:12:export function CommandPalette({ commands, onClose }: Props) {\nsrc/app/Shell.tsx:40:      {paletteOpen && <CommandPalette commands={commands} onClose={closePalette} />}",
      read: "src/components/CommandPalette.tsx",
      finding: "The list is a plain `<ul>` with click handlers; no active index state. There's a `useHotkeys` hook in src/lib but it binds globally, which would conflict with the editor.",
    },
    plan: [
      "Track `activeIndex` in CommandPalette; reset on query change",
      "Handle ArrowUp/ArrowDown/Enter/Escape on the input",
      "Use listbox/option roles with aria-activedescendant",
      "Interaction tests with user-event",
    ],
    implement: {
      intro: "Adding the active index and key handling on the input.",
      diffs: [
        {
          path: "src/components/CommandPalette.tsx",
          header: "@@ -12,10 +12,27 @@ export function CommandPalette({ commands, onClose }: Props) {",
          body: `   const [query, setQuery] = useState("");
+  const [active, setActive] = useState(0);
   const results = useMemo(() => fuzzy(commands, query), [commands, query]);
+  useEffect(() => setActive(0), [query]);
+
+  function onKeyDown(e: React.KeyboardEvent) {
+    if (e.key === "ArrowDown") setActive((i) => Math.min(i + 1, results.length - 1));
+    else if (e.key === "ArrowUp") setActive((i) => Math.max(i - 1, 0));
+    else if (e.key === "Enter") results[active]?.run();
+    else if (e.key === "Escape") onClose();
+    else return;
+    e.preventDefault();
+  }

   return (
     <div className={styles.palette}>
-      <input value={query} onChange={(e) => setQuery(e.target.value)} />
+      <input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={onKeyDown} />`,
        },
      ],
      command: {
        tool: "execute",
        cmd: "npm install --save-dev @testing-library/user-event",
        why: "The interaction tests need `@testing-library/user-event`, which isn't installed yet.",
        output: "added 1 package, and audited 812 packages in 3s\nfound 0 vulnerabilities",
      },
      summary: "Arrow keys, Enter and Escape now work in the palette, with tests for each key.",
    },
    checks: webChecks,
    review: {
      stat: " package.json                                |  1 +\n src/components/CommandPalette.tsx           | 24 +++++++++++++++++++++--\n src/components/CommandPalette.test.tsx      | 48 +++++++++++++++++++++++++++++++++++++\n 3 files changed, 70 insertions(+), 3 deletions(-)",
      focus: "Key handling is correct and tests cover each key. Checking accessibility next.",
      changes: {
        comment: "Item 3 of the plan is missing: the list has no `role=\"listbox\"` and the input has no `aria-activedescendant`, so screen readers won't announce the active command. Also scroll the active item into view.",
        reply: "You're right, I skipped the ARIA part. Adding listbox/option roles, ids, aria-activedescendant and scrollIntoView({ block: \"nearest\" }).",
        fix: {
          path: "src/components/CommandPalette.tsx",
          header: "@@ -31,9 +31,17 @@ export function CommandPalette({ commands, onClose }: Props) {",
          body: `-      <ul>
+      <ul role="listbox" id="palette-list">
         {results.map((cmd, i) => (
-          <li key={cmd.id} onClick={cmd.run}>
+          <li
+            key={cmd.id}
+            id={\`palette-opt-\${i}\`}
+            role="option"
+            aria-selected={i === active}
+            ref={i === active ? scrollIntoView : undefined}
+            onClick={cmd.run}
+          >`,
        },
      },
      approve: "ARIA wiring is right and the active item scrolls into view. Approving.",
    },
    pr: { number: 1302, summary: "Opened PR #1302: keyboard navigation and screen-reader support for the command palette." },
  },
  {
    key: "atlas-theme-flash",
    projectId: "atlas-web",
    issue: 93,
    title: "Dark mode flashes white on first paint",
    slug: "theme-flash",
    prompt: "With dark mode on, a hard reload shows a white page for ~200ms before the theme applies.",
    roles: { planner: "antigravity", implementer: "antigravity", reviewer: "claude-code" },
    budgetPause: true,
    explore: {
      intro: "Checking when the theme class is applied.",
      search: "data-theme",
      searchOutput: "src/theme/ThemeProvider.tsx:22:    document.documentElement.dataset.theme = theme;",
      read: "src/theme/ThemeProvider.tsx",
      finding: "The theme is applied in a `useEffect`, i.e. after React hydrates. An inline script in index.html that sets `data-theme` before first paint fixes the flash.",
    },
    plan: [
      "Inline a tiny script in index.html that sets data-theme from storage",
      "Keep ThemeProvider as the source of truth after mount",
      "Add `color-scheme` to the root so form controls match",
    ],
    implement: {
      intro: "Adding the pre-paint script.",
      diffs: [
        {
          path: "index.html",
          header: "@@ -4,6 +4,14 @@",
          body: `     <meta charset="UTF-8" />
     <meta name="viewport" content="width=device-width, initial-scale=1.0" />
+    <script>
+      (function () {
+        var t = localStorage.getItem("atlas.theme");
+        if (!t) t = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
+        document.documentElement.dataset.theme = t;
+        document.documentElement.style.colorScheme = t;
+      })();
+    </script>
     <title>Atlas</title>`,
        },
      ],
      summary: "The theme is now set before first paint; no flash on hard reload in Chrome or Firefox.",
    },
    checks: webChecks,
    question: {
      at: "implement",
      text: "With no saved preference, should Atlas follow the system theme or default to light as it does today?",
      options: ["Follow the system theme", "Default to light"],
      context: "Following the system theme changes what existing users without a saved preference see.",
    },
    review: {
      stat: " index.html                   |  8 ++++++++\n src/theme/ThemeProvider.tsx  |  6 +++---\n 2 files changed, 11 insertions(+), 3 deletions(-)",
      focus: "Script is small, runs before CSS, and reads the same key as ThemeProvider. CSP allows inline scripts via the existing hash list; the hash was updated.",
      approve: "Approved.",
    },
    pr: { number: 1307, summary: "Opened PR #1307: apply theme before first paint." },
  },
  {
    key: "tide-s3-retry",
    projectId: "tidewater",
    issue: 134,
    title: "Retry S3 uploads with exponential backoff",
    slug: "s3-upload-retry",
    prompt: "Nightly export fails about once a week on a transient S3 503 (SlowDown). Uploads should retry with backoff and jitter, at most 5 attempts.",
    roles: { planner: "claude-code", implementer: "claude-code", reviewer: "codex" },
    explore: {
      intro: "Looking at the upload path.",
      search: "def upload_partition",
      searchOutput: "tidewater/export/s3.py:28:def upload_partition(client, bucket: str, key: str, path: Path) -> None:",
      read: "tidewater/export/s3.py",
      finding: "Uploads call `client.upload_file` once with no retry. botocore's standard retry mode would cover it, but we construct the client without a config. A small explicit retry wrapper is clearer and testable.",
    },
    plan: [
      "Add `retry(fn, attempts=5, base=0.5)` with full jitter",
      "Retry only on throttling and 5xx errors",
      "Tests with a fake client that fails twice",
    ],
    implement: {
      intro: "Writing the retry helper.",
      diffs: [
        {
          path: "tidewater/export/s3.py",
          header: "@@ -1,6 +1,25 @@",
          body: `+import random
+import time
+
+from botocore.exceptions import ClientError
+
+RETRYABLE = {"SlowDown", "ServiceUnavailable", "InternalError", "RequestTimeout"}
+
+
+def retry(fn, attempts: int = 5, base: float = 0.5):
+    for attempt in range(attempts):
+        try:
+            return fn()
+        except ClientError as e:
+            code = e.response["Error"]["Code"]
+            if code not in RETRYABLE or attempt == attempts - 1:
+                raise
+            time.sleep(random.uniform(0, base * 2**attempt))
+
+
 def upload_partition(client, bucket: str, key: str, path: Path) -> None:
-    client.upload_file(str(path), bucket, key)
+    retry(lambda: client.upload_file(str(path), bucket, key))`,
        },
      ],
      summary: "Uploads retry up to 5 times with full-jitter backoff on throttling and 5xx errors.",
    },
    checks: pyChecks,
    gateFailure: {
      check: "pytest",
      output: "FAILED tests/export/test_s3.py::test_retries_then_succeeds - AssertionError: assert 1 == 3\n +  where 1 = FakeClient.calls\n1 failed, 42 passed in 2.31s",
      note: "The fake client raises `ClientError` with code `503`, but S3 returns `SlowDown`. The test fixture is wrong, not the code. Fixing the fixture to match real S3 errors.",
      fix: {
        path: "tests/export/test_s3.py",
        header: "@@ -9,7 +9,7 @@ class FakeClient:",
        body: `     def upload_file(self, *args):
         self.calls += 1
         if self.calls < 3:
-            raise ClientError({"Error": {"Code": "503"}}, "PutObject")
+            raise ClientError({"Error": {"Code": "SlowDown"}}, "PutObject")`,
      },
    },
    review: {
      stat: " tidewater/export/s3.py    | 21 ++++++++++++++++++++-\n tests/export/test_s3.py   | 37 +++++++++++++++++++++++++++++++++++++\n 2 files changed, 57 insertions(+), 1 deletion(-)",
      focus: "Retry set matches S3's documented transient errors. Tests patch `time.sleep`, so they're fast.",
      approve: "Approved. Consider surfacing the attempt count in the export log later.",
    },
    pr: { number: 66, summary: "Opened PR #66: retry S3 uploads with jittered exponential backoff." },
  },
  {
    key: "tide-schema-drift",
    projectId: "tidewater",
    issue: 141,
    title: "Detect Parquet schema drift during ingest",
    slug: "schema-drift-check",
    prompt: "Upstream added a column last month and ingest silently dropped it. Compare incoming Parquet schemas with the registered one and fail loudly on drift.",
    roles: { planner: "codex", implementer: "codex", reviewer: "claude-code" },
    explore: {
      intro: "Finding where schemas are registered and read.",
      search: "pq.read_schema",
      searchOutput: "tidewater/ingest/reader.py:44:    schema = pq.read_schema(path)",
      read: "tidewater/ingest/reader.py",
      finding: "The reader reads the schema but only uses it to pick columns. Registered schemas live in `schemas/*.json`.",
    },
    plan: [
      "Load the registered schema for the dataset",
      "Diff field names and types; classify added/removed/changed",
      "Fail ingest on removed/changed; warn on added",
      "CLI flag `--accept-drift` to update the registry",
    ],
    planApproval: true,
    implement: {
      intro: "Implementing the schema diff.",
      diffs: [
        {
          path: "tidewater/ingest/drift.py",
          header: "@@ -0,0 +1,15 @@",
          body: `+from dataclasses import dataclass
+
+import pyarrow as pa
+
+
+@dataclass
+class Drift:
+    added: list[str]
+    removed: list[str]
+    changed: list[tuple[str, str, str]]
+
+
+def diff(registered: pa.Schema, incoming: pa.Schema) -> Drift:
+    reg, inc = {f.name: f for f in registered}, {f.name: f for f in incoming}
+    return Drift(sorted(inc.keys() - reg.keys()), sorted(reg.keys() - inc.keys()), _changed(reg, inc))`,
        },
      ],
      summary: "Ingest now diffs incoming schemas against the registry, fails on removed or changed fields and warns on new ones.",
    },
    checks: pyChecks,
    review: {
      stat: " tidewater/ingest/drift.py  | 38 ++++++++++++++++++++++++++++\n tidewater/ingest/reader.py | 12 +++++++--\n tidewater/cli.py           |  9 ++++++\n tests/ingest/test_drift.py | 52 +++++++++++++++++++++++++++++++++++++++++\n 4 files changed, 109 insertions(+), 2 deletions(-)",
      focus: "Diff logic is clear. Checking type comparison edge cases.",
      changes: {
        comment: "Comparing `str(field.type)` flags `timestamp[us]` vs `timestamp[us, tz=UTC]` as a change, which upstream does every DST migration. Please treat timezone-only differences as a warning, not a failure.",
        reply: "Makes sense; I'll special-case timestamp fields whose unit matches and only the tz differs.",
        fix: {
          path: "tidewater/ingest/drift.py",
          header: "@@ -18,6 +18,12 @@ def diff(registered: pa.Schema, incoming: pa.Schema) -> Drift:",
          body: `+def _same_modulo_tz(a: pa.DataType, b: pa.DataType) -> bool:
+    return (
+        pa.types.is_timestamp(a)
+        and pa.types.is_timestamp(b)
+        and a.unit == b.unit
+    )`,
        },
      },
      approve: "Timezone handling looks right now. Approving.",
    },
    pr: { number: 71, summary: "Opened PR #71: detect Parquet schema drift during ingest." },
  },
  {
    key: "core-aux-ps-json",
    projectId: "agentux-core",
    issue: 63,
    title: "`aux ps --json` for scripting",
    slug: "aux-ps-json",
    prompt: "Add a `--json` flag to `aux ps` that prints runs as JSON lines so people can pipe it into jq.",
    roles: { planner: "opencode", implementer: "opencode", reviewer: "claude-code" },
    explore: {
      intro: "Checking the `ps` subcommand.",
      search: "fn cmd_ps",
      searchOutput: "src/bin/aux/ps.rs:9:pub fn cmd_ps(client: &Client, args: PsArgs) -> Result<()> {",
      read: "src/bin/aux/ps.rs",
      finding: "`RunSummary` already derives `Serialize`; only the flag and an output branch are missing.",
    },
    plan: ["Add `--json` to `PsArgs`", "Print one JSON object per line", "Snapshot test"],
    implement: {
      intro: "Small change; adding the flag.",
      diffs: [
        {
          path: "src/bin/aux/ps.rs",
          header: "@@ -9,6 +9,12 @@ pub fn cmd_ps(client: &Client, args: PsArgs) -> Result<()> {",
          body: `     let runs = client.list_runs(args.project.as_deref())?;
+    if args.json {
+        for run in &runs {
+            println!("{}", serde_json::to_string(run)?);
+        }
+        return Ok(());
+    }
     print_table(&runs);`,
        },
      ],
      summary: "`aux ps --json` prints one JSON object per run.",
    },
    checks: rustChecks,
    review: {
      stat: " src/bin/aux/ps.rs | 8 ++++++++\n tests/cli_ps.rs   | 19 +++++++++++++++++++\n 2 files changed, 27 insertions(+)",
      focus: "Straightforward. JSON lines is the right call for jq.",
      approve: "Approved.",
    },
    pr: { number: 112, summary: "Opened PR #112: `aux ps --json`." },
  },
  {
    key: "atlas-virtual-table",
    projectId: "atlas-web",
    issue: 97,
    title: "Virtualize the reports table",
    slug: "virtual-reports-table",
    prompt: "The reports table renders all 20k rows and scrolling stutters. Only render visible rows.",
    roles: { planner: "codex", implementer: "codex", reviewer: "antigravity" },
    explore: {
      intro: "Looking at the table component.",
      search: "ReportsTable",
      searchOutput: "src/reports/ReportsTable.tsx:8:export function ReportsTable({ rows }: Props) {",
      read: "src/reports/ReportsTable.tsx",
      finding: "Rows have a fixed height of 36px, so windowing without a dependency is straightforward.",
    },
    plan: ["Fixed-height windowing with overscan", "Keep sticky header", "Test that only visible rows render"],
    implement: {
      intro: "Implementing windowing.",
      diffs: [
        {
          path: "src/reports/ReportsTable.tsx",
          header: "@@ -8,8 +8,14 @@ export function ReportsTable({ rows }: Props) {",
          body: `-  return (
-    <div className={styles.scroll}>
-      {rows.map((r) => <Row key={r.id} row={r} />)}
+  const [top, setTop] = useState(0);
+  const start = Math.max(0, Math.floor(top / ROW_H) - OVERSCAN);
+  const end = Math.min(rows.length, start + Math.ceil(VIEW_H / ROW_H) + OVERSCAN * 2);
+  return (
+    <div className={styles.scroll} onScroll={(e) => setTop(e.currentTarget.scrollTop)}>
+      <div style={{ height: rows.length * ROW_H, position: "relative" }}>
+        {rows.slice(start, end).map((r, i) => <Row key={r.id} row={r} top={(start + i) * ROW_H} />)}
+      </div>`,
        },
      ],
      summary: "The reports table only renders visible rows plus overscan; scrolling 20k rows stays at 60fps.",
    },
    checks: webChecks,
    review: {
      stat: " src/reports/ReportsTable.tsx      | 18 +++++++++++++-----\n src/reports/ReportsTable.test.tsx | 22 ++++++++++++++++++++++\n 2 files changed, 35 insertions(+), 5 deletions(-)",
      focus: "Windowing math checks out at both ends.",
      approve: "Approved.",
    },
    pr: { number: 1311, summary: "Opened PR #1311: virtualize the reports table." },
  },
];

/** Initial state: which scenarios are live, how far along, and how long ago they started. */
export const SEED: { key: string; until: string | number; minutesAgo: number }[] = [
  { key: "core-worktree-gc", until: "review-changes", minutesAgo: 26 },
  { key: "ledger-idempotency", until: "plan-approval", minutesAgo: 7 },
  { key: "atlas-palette-keys", until: "command-approval", minutesAgo: 12 },
  { key: "tide-s3-retry", until: "gate-fail", minutesAgo: 18 },
  { key: "atlas-theme-flash", until: "budget", minutesAgo: 9 },
  { key: "ledger-n-plus-one", until: 5, minutesAgo: 2 },
  { key: "tide-schema-drift", until: "gate-start", minutesAgo: 15 },
  { key: "core-bus-turns", until: "end", minutesAgo: 95 },
  { key: "core-aux-ps-json", until: "end", minutesAgo: 140 },
  { key: "atlas-virtual-table", until: "end", minutesAgo: 210 },
];
