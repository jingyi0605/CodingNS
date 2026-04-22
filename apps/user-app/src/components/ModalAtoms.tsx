import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  ReactNode
} from "react";

type ModalTone = "default" | "accent" | "success" | "warning" | "danger";

interface ModalSectionProps {
  readonly heading?: ReactNode;
  readonly description?: ReactNode;
  readonly actions?: ReactNode;
  readonly tone?: Exclude<ModalTone, "success" | "warning">;
  readonly className?: string;
  readonly children: ReactNode;
}

interface ModalFieldProps {
  readonly label: ReactNode;
  readonly description?: ReactNode;
  readonly className?: string;
  readonly htmlFor?: string;
  readonly children: ReactNode;
}

interface ModalActionsProps extends HTMLAttributes<HTMLDivElement> {
  readonly align?: "start" | "end" | "between";
  readonly stack?: boolean;
}

interface ModalListProps extends HTMLAttributes<HTMLDivElement> {
  readonly compact?: boolean;
}

interface ModalListItemBaseProps {
  readonly label?: ReactNode;
  readonly description?: ReactNode;
  readonly leading?: ReactNode;
  readonly trailing?: ReactNode;
  readonly tone?: "default" | "danger";
  readonly selected?: boolean;
  readonly className?: string;
  readonly children?: ReactNode;
}

type ModalListItemProps =
  | ({ readonly as?: "div" } & ModalListItemBaseProps & HTMLAttributes<HTMLDivElement>)
  | ({ readonly as: "button" } & ModalListItemBaseProps & ButtonHTMLAttributes<HTMLButtonElement>);

interface ModalEmptyStateProps {
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly action?: ReactNode;
  readonly className?: string;
  readonly compact?: boolean;
}

interface ModalTagProps extends HTMLAttributes<HTMLSpanElement> {
  readonly tone?: ModalTone;
}

export function ModalSection({
  heading,
  description,
  actions,
  tone = "default",
  className,
  children
}: ModalSectionProps) {
  return (
    <section
      className={joinClassNames("modal-section", className)}
      data-tone={tone}
    >
      {heading || description || actions ? (
        <div className="modal-section-header">
          <div className="modal-section-copy">
            {heading ? <strong className="modal-section-heading">{heading}</strong> : null}
            {description ? <p className="modal-section-description">{description}</p> : null}
          </div>
          {actions ? <div className="modal-section-actions">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function ModalField({
  label,
  description,
  className,
  htmlFor,
  children
}: ModalFieldProps) {
  return (
    <div className={joinClassNames("workbench-modal-field", "modal-field", className)}>
      <div className="modal-field-copy">
        {htmlFor ? (
          <label className="modal-field-label" htmlFor={htmlFor}>
            {label}
          </label>
        ) : (
          <span className="modal-field-label">{label}</span>
        )}
        {description ? <span className="modal-field-description">{description}</span> : null}
      </div>
      {children}
    </div>
  );
}

export function ModalActions({
  align = "end",
  stack = false,
  className,
  children,
  ...props
}: ModalActionsProps) {
  return (
    <div
      className={joinClassNames("workbench-modal-actions", "modal-actions", className)}
      data-align={align}
      data-stack={stack ? "true" : undefined}
      {...props}
    >
      {children}
    </div>
  );
}

export function ModalList({
  compact = false,
  className,
  children,
  ...props
}: ModalListProps) {
  return (
    <div
      className={joinClassNames("modal-list", className)}
      data-compact={compact ? "true" : undefined}
      {...props}
    >
      {children}
    </div>
  );
}

export function ModalListItem(props: ModalListItemProps) {
  const {
    as = "div",
    label,
    description,
    leading,
    trailing,
    tone = "default",
    selected = false,
    className,
    children,
    ...restProps
  } = props as ModalListItemProps & {
    readonly as?: "div" | "button";
  };
  const commonClassName = joinClassNames("modal-list-item", className);
  const sharedProps = {
    className: commonClassName,
    "data-tone": tone !== "default" ? tone : undefined,
    "data-selected": selected ? "true" : undefined,
    "data-interactive": as === "button" ? "true" : undefined
  };

  const content = (
    <>
      <div className="modal-list-item-main">
        {leading ? <div className="modal-list-item-leading">{leading}</div> : null}
        <div className="modal-list-item-copy">
          {label ? <span className="modal-list-item-label">{label}</span> : null}
          {description ? <span className="modal-list-item-description">{description}</span> : null}
          {children}
        </div>
      </div>
      {trailing ? <div className="modal-list-item-trailing">{trailing}</div> : null}
    </>
  );

  if (as === "button") {
    const buttonProps = restProps as ButtonHTMLAttributes<HTMLButtonElement>;

    return (
      <button
        type={buttonProps.type ?? "button"}
        {...buttonProps}
        {...sharedProps}
      >
        {content}
      </button>
    );
  }

  return (
    <div
      {...(restProps as HTMLAttributes<HTMLDivElement>)}
      {...sharedProps}
    >
      {content}
    </div>
  );
}

export function ModalEmptyState({
  title,
  description,
  action,
  className,
  compact = false
}: ModalEmptyStateProps) {
  return (
    <div
      className={joinClassNames("modal-empty-state", className)}
      data-compact={compact ? "true" : undefined}
    >
      <strong className="modal-empty-state-title">{title}</strong>
      {description ? <p className="modal-empty-state-description">{description}</p> : null}
      {action ? <div className="modal-empty-state-action">{action}</div> : null}
    </div>
  );
}

export function ModalTag({
  tone = "default",
  className,
  children,
  ...props
}: ModalTagProps) {
  return (
    <span
      className={joinClassNames("modal-tag", className)}
      data-tone={tone !== "default" ? tone : undefined}
      {...props}
    >
      {children}
    </span>
  );
}

function joinClassNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}
