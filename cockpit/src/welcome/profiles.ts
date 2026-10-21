/**
 * The AgentUX OS profiles (agentux-os `/usr/share/agentux/profiles`): what
 * each one is, in words a person choosing it needs, and which wizard steps
 * follow it.
 */

export type ProfileId = "workstation" | "node" | "command" | "executive" | "complete" | "custom";

export type StepId = "profile" | "role" | "agents" | "tools" | "git" | "done";

export interface Profile {
  id: ProfileId;
  title: string;
  /** One line under the title. */
  tagline: string;
  /** What the machine does, in a sentence or two. */
  what: string;
  /** Who or what it is for. */
  forWho: string;
  /** What runs on this machine. */
  runsHere: string[];
  /** How it fits with the other machines. */
  howItWorks: string;
  /** Hardware and network. */
  needs: string;
  /** The role step's title, when the profile has one. */
  roleStep?: { title: string; sub: string };
  /** Whether agents run here (the Agents and Git steps). */
  agents: boolean;
  /** Whether it has the desktop's developer tools (the Tools step). */
  desktop: boolean;
}

export const PROFILES: Profile[] = [
  {
    id: "workstation",
    title: "Workstation",
    tagline: "Your own computer, with your coding agents",
    what: "Coding agents work on your projects on this computer, and the AgentUX cockpit lets you follow them, approve their plans and step in.",
    forWho: "A developer's desktop or laptop.",
    runsHere: ["agentuxd, which runs the agents' work in git worktrees", "The agent CLIs (Claude Code, Codex, OpenCode, Antigravity)", "The cockpit and your developer tools"],
    howItWorks: "Works on its own. It can also report to an AgentUX Command server, so a team sees it and can send it work, if you connect it.",
    needs: "8 GB RAM, 40 GB storage; network for the agents' providers.",
    roleStep: { title: "Command", sub: "Optional: connect to a team" },
    agents: true,
    desktop: true,
  },
  {
    id: "node",
    title: "Agent Node",
    tagline: "A worker that runs agents for others",
    what: "Runs coding agents without a desktop. Work arrives from AgentUX Command or from someone using aux over SSH.",
    forWho: "Servers and virtual machines that add agent capacity to a team.",
    runsHere: ["agentuxd and the agent CLIs", "The node gateway, which reports to Command and takes its commands"],
    howItWorks:
      "It connects out to a Command server (no ports to open on the node) and does what Command asks within its own policy: starting runs can wait for confirmation, credentials never leave it.",
    needs: "4 GB RAM, 20 GB storage; network to Command and to the agents' providers.",
    roleStep: { title: "Command", sub: "Connect this node" },
    agents: true,
    desktop: false,
  },
  {
    id: "command",
    title: "Command Server",
    tagline: "The control center for many machines",
    what: "Coordinates an organization's nodes and workstations: missions, approvals, policies, costs and health in one place. It runs no agents itself.",
    forWho: "One server per organization or team, reachable by its nodes.",
    runsHere: ["AgentUX Command and its services (PostgreSQL, Temporal, NATS, object storage) as containers"],
    howItWorks:
      "Nodes connect to it with their own tokens and report what they do; operators send them work and approve from here or from the Office view.",
    needs: "16 GB RAM, 100 GB storage; a stable address (DNS name) with TLS that the nodes can reach.",
    roleStep: { title: "Command server", sub: "What to set up" },
    agents: false,
    desktop: false,
  },
  {
    id: "executive",
    title: "Executive",
    tagline: "The overview for people who lead",
    what: "The Office view of an organization: missions, who works on what, approvals waiting and spending, from a Command server.",
    forWho: "Team leads and managers who follow and approve work without running agents.",
    runsHere: ["The AgentUX Office client"],
    howItWorks: "Reads from and acts through a Command server; nothing runs or is stored on this machine.",
    needs: "8 GB RAM, 40 GB storage; network to Command.",
    roleStep: { title: "Command", sub: "Which server to follow" },
    agents: false,
    desktop: false,
  },
  {
    id: "complete",
    title: "Complete",
    tagline: "Everything on one machine",
    what: "Workstation, Agent Node, Command Server and Office together.",
    forWho: "Trying AgentUX end to end, demos, or a one-person setup.",
    runsHere: ["Everything above"],
    howItWorks: "The local node reports to the Command server on the same machine.",
    needs: "24 GB RAM, 150 GB storage; network.",
    roleStep: { title: "Command server", sub: "Server and node" },
    agents: true,
    desktop: true,
  },
  {
    id: "custom",
    title: "Custom",
    tagline: "Pick the capabilities yourself",
    what: "No role now; add capabilities later with `agentux profile`.",
    forWho: "Administrators with a plan of their own.",
    runsHere: ["What you apply later"],
    howItWorks: "Nothing is applied until you choose.",
    needs: "Depends on the capabilities.",
    agents: true,
    desktop: true,
  },
];

export function profileById(id: string | null | undefined): Profile {
  return PROFILES.find((p) => p.id === id) ?? PROFILES[0];
}

/** The wizard's steps for a profile, in order. */
export function stepsFor(profile: Profile): StepId[] {
  const steps: StepId[] = ["profile"];
  if (profile.roleStep) steps.push("role");
  if (profile.agents) steps.push("agents");
  if (profile.desktop) steps.push("tools");
  if (profile.agents) steps.push("git");
  steps.push("done");
  return steps;
}
