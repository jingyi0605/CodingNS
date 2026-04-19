import type { ReactNode } from "react";

export function RemoteAccessMetricGrid({ children }: { readonly children: ReactNode }) {
  return <div className="settings-remote-access-metrics">{children}</div>;
}

export function RemoteAccessMetricCard({
  label,
  value
}: {
  readonly label: ReactNode;
  readonly value: ReactNode;
}) {
  return (
    <article className="settings-remote-access-metric-card">
      <span className="settings-remote-access-metric-label">{label}</span>
      <strong className="settings-remote-access-metric-value">{value}</strong>
    </article>
  );
}

export function RemoteAccessActivationSwitch({
  checked,
  label,
  disabled,
  onChange
}: {
  readonly checked: boolean;
  readonly label: string;
  readonly disabled?: boolean;
  readonly onChange: (checked: boolean) => void;
}) {
  return (
    <div className="settings-remote-access-switch">
      <span className="settings-remote-access-switch-label">{label}</span>
      <label
        className="settings-mobile-switch"
        data-disabled={disabled ? "true" : undefined}
        onClick={(event) => {
          if (disabled) {
            event.preventDefault();
            return;
          }

          if (event.target instanceof HTMLInputElement) {
            return;
          }

          event.preventDefault();
          onChange(!checked);
        }}
      >
        <input
          type="checkbox"
          aria-label={label}
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span className="settings-mobile-switch-track" aria-hidden="true">
          <span className="settings-mobile-switch-thumb" />
        </span>
      </label>
    </div>
  );
}
