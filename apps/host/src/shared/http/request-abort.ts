import type { FastifyRequest } from "fastify";

export function createRequestAbortSignal(request: FastifyRequest): AbortSignal {
  const controller = new AbortController();
  const raw = request.raw as typeof request.raw & {
    aborted?: boolean;
    complete?: boolean;
  };

  const abort = (reason: string) => {
    if (controller.signal.aborted) {
      return;
    }

    cleanup();
    controller.abort(new Error(reason));
  };

  const onAborted = () => {
    abort("request aborted");
  };

  const onClose = () => {
    if (raw.aborted || raw.complete === false) {
      abort("request aborted");
      return;
    }

    cleanup();
  };

  const onError = () => {
    abort("request aborted");
  };

  const cleanup = () => {
    raw.off?.("aborted", onAborted);
    raw.off?.("close", onClose);
    raw.off?.("error", onError);
  };

  if (raw.aborted || raw.destroyed) {
    controller.abort(new Error("request aborted"));
    return controller.signal;
  }

  raw.on("aborted", onAborted);
  raw.on("close", onClose);
  raw.on("error", onError);

  return controller.signal;
}
