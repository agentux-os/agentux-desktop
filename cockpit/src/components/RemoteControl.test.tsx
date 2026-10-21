// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MockSetupClient } from "../setup/mock";
import { describeCommand, RemoteControl } from "./RemoteControl";

async function settle() {
  await act(async () => {
    for (let i = 0; i < 4; i++) await Promise.resolve();
  });
}

describe("RemoteControl", () => {
  afterEach(cleanup);

  it("describes what a held command would do", () => {
    expect(
      describeCommand({
        commandId: "c",
        method: "run.start",
        params: { repository: "https://github.com/acme/app", prompt: "Fix it", agents: { implementer: "opencode" } },
        receivedAt: "2026-10-21T14:00:00Z",
      }),
    ).toBe('in https://github.com/acme/app · "Fix it" · agents: implementer opencode');
  });

  it("shows where the node reports and accepts a held command", async () => {
    const setup = new MockSetupClient();
    render(<RemoteControl setup={async () => setup} pollMs={60_000} />);
    await settle();
    expect(screen.getByText(/reports to/).textContent).toContain("https://command.example.org");
    const list = screen.getByLabelText("Commands waiting for you");
    expect(list.textContent).toContain("Start a run");
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    await settle();
    expect(setup.calls).toContain("node confirm cmd-7f3a");
    expect(screen.getByText("No command from Command is waiting.")).toBeTruthy();
  });
});
