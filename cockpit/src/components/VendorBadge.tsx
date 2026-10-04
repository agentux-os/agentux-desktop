import type { CSSProperties } from "react";
import type { Vendor } from "../daemon/types";
import { harnessInfo } from "../daemon/vendors";
import { roleLabel } from "../lib/labels";

/** Accent colour of a vendor; neutral for harnesses the cockpit does not know. */
export function vendorStyle(vendor: Vendor | undefined): CSSProperties {
  return { ["--vc" as string]: `var(${harnessInfo(vendor).colorVar})` };
}

/** Vendor identity, rendered the same everywhere: coloured monogram + harness name. */
export function VendorBadge({
  vendor,
  harness,
  role,
  compact = false,
}: {
  vendor?: Vendor;
  /** Harness id, shown when the vendor is unknown. */
  harness?: string;
  role?: string;
  compact?: boolean;
}) {
  const info = harnessInfo(vendor, harness);
  const title = `${info.label} (${info.maker})${role ? ` · ${roleLabel(role)}` : ""}`;
  if (compact) {
    return (
      <span className="vmono" style={vendorStyle(vendor)} title={title}>
        {info.mono}
      </span>
    );
  }
  return (
    <span className="vbadge" style={vendorStyle(vendor)} title={title}>
      <span className="vmono">{info.mono}</span>
      <span className="vbadge-label">{info.label}</span>
      {role && <span className="vbadge-role">{roleLabel(role)}</span>}
    </span>
  );
}
