// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { UpdateImage, UpdateStatus } from "../setup/client";
import { MockSetupClient } from "../setup/mock";
import { UpdateBanner, imageName, notesUrl } from "./UpdateBanner";

const image = (release: string | null, digest: string): UpdateImage => ({
  image: "ghcr.io/agentux-os/agentux:stable",
  digest,
  version: "44.20261022",
  release,
});

const status = (booted: UpdateImage, staged: UpdateImage | null): UpdateStatus => ({
  checkedAt: "2026-10-22T10:00:00Z",
  result: staged ? "staged" : "current",
  detail: null,
  booted,
  staged,
});

async function show(client: MockSetupClient) {
  render(<UpdateBanner setup={async () => client} />);
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe("UpdateBanner", () => {
  it("says a staged update is ready, notifies once per image, and restarts", async () => {
    const client = new MockSetupClient({ update: status(image("v0.6.5", "sha256:a"), image("v0.6.6", "sha256:b")) });
    await show(client);
    expect(screen.getByText("AgentUX v0.6.6 is ready.")).toBeTruthy();
    const notes = screen.getByRole("link", { name: "What's new" }) as HTMLAnchorElement;
    expect(notes.href).toBe("https://github.com/agentux-os/agentux-os/releases/tag/v0.6.6");
    expect(client.calls.filter((c) => c.startsWith("notify"))).toHaveLength(1);

    cleanup();
    await show(client);
    expect(client.calls.filter((c) => c.startsWith("notify"))).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Restart" }));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(client.calls).toContain("restart");
  });

  it("says once what the machine runs after a restart into a new image", async () => {
    await show(new MockSetupClient({ update: status(image("v0.6.5", "sha256:a"), null) }));
    expect(screen.queryByRole("status")).toBeNull();
    cleanup();

    await show(new MockSetupClient({ update: status(image("v0.6.6", "sha256:b"), null) }));
    expect(screen.getByText("This machine now runs AgentUX v0.6.6.")).toBeTruthy();
    cleanup();

    await show(new MockSetupClient({ update: status(image("v0.6.6", "sha256:b"), null) }));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows nothing without a status", async () => {
    await show(new MockSetupClient());
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("names images without a known release by their version", () => {
    expect(imageName(image(null, "sha256:c"))).toBe("AgentUX 44.20261022");
    expect(notesUrl(image(null, "sha256:c"))).toBe("https://github.com/agentux-os/agentux-os/releases");
  });
});
