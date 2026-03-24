import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren
} from "react";

export type ToastTone = "info" | "success" | "warning" | "error";

interface ToastAction {
  label: string;
  onClick: () => void;
}

interface ToastRecord {
  id: string;
  title: string;
  description?: string;
  tone: ToastTone;
  durationMs: number | null;
  action?: ToastAction;
}

export interface ShowToastOptions {
  id?: string;
  title: string;
  description?: string;
  tone?: ToastTone;
  durationMs?: number | null;
  action?: ToastAction;
}

interface ToastContextValue {
  showToast: (options: ShowToastOptions) => string;
  dismissToast: (id: string) => void;
}

const defaultToastContext: ToastContextValue = {
  showToast: () => "",
  dismissToast: () => undefined
};

const ToastContext = createContext<ToastContextValue>(defaultToastContext);

function createToastId() {
  return `toast-${Math.random().toString(36).slice(2, 10)}`;
}

function ToastItem({
  toast,
  onDismiss
}: {
  toast: ToastRecord;
  onDismiss: (id: string) => void;
}) {
  const { id, title, description, tone, durationMs, action } = toast;

  useEffect(() => {
    if (durationMs === null) {
      return;
    }

    const timer = window.setTimeout(() => {
      onDismiss(id);
    }, durationMs);

    return () => {
      window.clearTimeout(timer);
    };
  }, [durationMs, id, onDismiss, title, description, tone]);

  return (
    <article className="toast-card" data-tone={tone} role={tone === "error" ? "alert" : "status"}>
      <div className="toast-body">
        <strong className="toast-title">{title}</strong>
        {description ? <p className="toast-description">{description}</p> : null}
      </div>
      <div className="toast-actions">
        {action ? (
          <button
            className="toast-action"
            type="button"
            onClick={() => {
              action.onClick();
              onDismiss(id);
            }}
          >
            {action.label}
          </button>
        ) : null}
        <button className="toast-dismiss" type="button" aria-label="关闭通知" onClick={() => onDismiss(id)}>
          x
        </button>
      </div>
    </article>
  );
}

export function ToastProvider({ children }: PropsWithChildren) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);

  const dismissToast = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const showToast = useCallback((options: ShowToastOptions) => {
    const id = options.id ?? createToastId();
    const nextToast: ToastRecord = {
      id,
      title: options.title,
      description: options.description,
      tone: options.tone ?? "info",
      durationMs: options.durationMs === undefined ? 4200 : options.durationMs,
      action: options.action
    };

    setToasts((current) => {
      const index = current.findIndex((toast) => toast.id === id);

      if (index === -1) {
        return [...current, nextToast];
      }

      const next = [...current];
      next[index] = nextToast;
      return next;
    });

    return id;
  }, []);

  const contextValue = useMemo(
    () => ({
      showToast,
      dismissToast
    }),
    [dismissToast, showToast]
  );

  return (
    <ToastContext.Provider value={contextValue}>
      {children}
      <div className="toast-viewport" aria-live="polite" aria-atomic="false">
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onDismiss={dismissToast} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
