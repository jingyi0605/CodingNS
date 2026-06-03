interface SettingsSwitchProps {
  readonly checked: boolean;
  readonly label: string;
  readonly onChange: (checked: boolean) => void;
  readonly semanticRole?: "checkbox" | "switch";
}

export function SettingsSwitch({
  checked,
  label,
  onChange,
  semanticRole = "checkbox"
}: SettingsSwitchProps) {
  return (
    <label
      className="settings-mobile-switch"
      aria-label={label}
      onClick={(event) => {
        if (event.target instanceof HTMLInputElement) {
          return;
        }

        event.preventDefault();
        // 不把交互赌在隐藏 input 的默认点击行为上，直接让可见开关自己切换。
        onChange(!checked);
      }}
    >
      <input
        type="checkbox"
        role={semanticRole}
        aria-label={label}
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="settings-mobile-switch-track" aria-hidden="true">
        <span className="settings-mobile-switch-thumb" />
      </span>
    </label>
  );
}
