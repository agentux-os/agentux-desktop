import { help } from "../helper/content";
import { PROFILES, profileById, stepsFor, type ProfileId } from "./profiles";

const STEP_NAME: Record<string, string> = {
  role: "connect or set up Command",
  agents: "the agent CLIs",
  tools: "developer tools",
  git: "Git and SSH",
};

/**
 * The first step: what this machine is for. Each profile says what it does,
 * who it is for, what runs on the machine, how it works with the others and
 * what it needs; the following steps depend on the choice.
 */
export function ProfileStep({
  selected,
  saved,
  onSelect,
  components = [],
  catalog = [],
  onComponents = () => {},
}: {
  selected: ProfileId;
  /** The profile the system recorded, if any. */
  saved: string | null | undefined;
  onSelect: (id: ProfileId) => void;
  /** The custom profile's chosen components. */
  components?: string[];
  /** The components the OS catalog offers. */
  catalog?: { id: string; label: string }[];
  onComponents?: (ids: string[]) => void;
}) {
  const p = profileById(selected);
  const next = stepsFor(p).filter((s) => s in STEP_NAME).map((s) => STEP_NAME[s]);
  return (
    <div className="wz-stack">
      <div className="wz-profile-grid" role="radiogroup" aria-label="Profiles" {...help("wz.profile.choose")}>
        {PROFILES.map((option) => (
          <label key={option.id} className={`wz-profile-option ${selected === option.id ? "is-selected" : ""}`}>
            <input
              type="radio"
              name="os-profile"
              value={option.id}
              checked={selected === option.id}
              onChange={() => onSelect(option.id)}
            />
            <strong>{option.title}</strong>
            <span>{option.tagline}</span>
            {saved === option.id && <small className="ok">Current</small>}
          </label>
        ))}
      </div>

      <section className="wz-card wz-profile-detail" aria-labelledby="profile-detail" aria-live="polite">
        <h2 id="profile-detail">{p.title}</h2>
        <p>{p.what}</p>
        <dl>
          <dt>For</dt>
          <dd>{p.forWho}</dd>
          <dt>Runs on this machine</dt>
          <dd>
            <ul>
              {p.runsHere.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </dd>
          <dt>How it works</dt>
          <dd>{p.howItWorks}</dd>
          <dt>Needs</dt>
          <dd>{p.needs}</dd>
          <dt>Next in this wizard</dt>
          <dd>{next.length ? next.join(", then ") : "a summary"}.</dd>
        </dl>
        {selected === "custom" && (
          <fieldset className="wz-capabilities" {...help("wz.profile.custom")}>
            <legend>Capabilities</legend>
            {catalog.length === 0 ? (
              <p className="muted">This system's profile catalog is not available, so there is nothing to choose from.</p>
            ) : (
              catalog.map((c) => (
                <label key={c.id}>
                  <input
                    type="checkbox"
                    checked={components.includes(c.id)}
                    onChange={(e) =>
                      onComponents(
                        e.target.checked ? [...components, c.id].sort() : components.filter((id) => id !== c.id),
                      )
                    }
                  />
                  {c.label} <code>{c.id}</code>
                </label>
              ))
            )}
          </fieldset>
        )}
        <p className="muted wz-small">
          The choice is saved when you continue and applied by the system; nothing is downloaded for it. You can come back
          and change it.
        </p>
      </section>
    </div>
  );
}
