import type { CSSProperties } from "react";
import type { Role, Vendor } from "../daemon/types";
import { VENDOR_INFO } from "../daemon/vendors";
import { ROLE_LABEL } from "../lib/labels";

export function vendorStyle(vendor: Vendor): CSSProperties {
  return { ["--vc" as string]: `var(${VENDOR_INFO[vendor].colorVar})` };
}

/** Vendor identity, rendered the same everywhere: coloured monogram + harness name. */
export function VendorBadge({
  vendor,
  role,
  compact = false,
}: {
  vendor: Vendor;
  role?: Role;
  compact?: boolean;
}) {
  const info = VENDOR_INFO[vendor];
  const title = `${info.label} (${info.maker})${role ? ` · ${ROLE_LABEL[role]}` : ""}`;
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
      {role && <span className="vbadge-role">{ROLE_LABEL[role]}</span>}
    </span>
  );
}
