import type { TeableRuntimeFieldDto } from "../api/teable-runtime-api";
import { resolveTeableCellDisplay, type TeableCellDisplayValue } from "./teable-field-utils";

export function TeableCellRenderer({ field, value }: { field: TeableRuntimeFieldDto; value: unknown }) {
  const display = resolveTeableCellDisplay(field, value);
  if (display.tokens.length > 0) {
    return (
      <span
        className="teable-runtime-cell"
        data-kind={display.kind}
        data-readonly={display.readonly ? "true" : undefined}
        title={display.text}
      >
        <TeableCellTokenList display={display} />
      </span>
    );
  }
  return (
    <span
      className="teable-runtime-cell"
      data-kind={display.kind}
      data-readonly={display.readonly ? "true" : undefined}
      title={display.text}
    >
      {display.text}
    </span>
  );
}

export function TeableCellTokenList({ display }: { display: TeableCellDisplayValue }) {
  return (
    <span className="teable-runtime-token-list" data-kind={display.kind}>
      {display.tokens.map((token) => (
        <span key={token.key} className="teable-runtime-token" data-tone={token.tone}>
          {display.kind === "user" ? <span className="teable-runtime-token-avatar" aria-hidden="true">{token.label.slice(0, 1)}</span> : null}
          <span>{token.label}</span>
        </span>
      ))}
    </span>
  );
}
