import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";

import { clientConfigStore } from "../../../config/client-config-store";
import { buildRelayEntryConfigPatch } from "../../../config/relay-entry";
import { t, useT } from "../../../shared/i18n";

export function RelayConnectEntryPage() {
  const navigate = useNavigate();
  const { tunnelDomain } = useParams<{ tunnelDomain: string }>();
  const [searchParams] = useSearchParams();
  const translate = useT();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const controlBaseUrl = searchParams.get("controlBaseUrl")?.trim() ?? "";

    if (!tunnelDomain || !controlBaseUrl) {
      setErrorMessage(translate("auth.relayEntryInvalid"));
      return;
    }

    let cancelled = false;
    const returnTo = normalizeReturnTo(searchParams.get("returnTo"));

    void clientConfigStore.update(
      buildRelayEntryConfigPatch(clientConfigStore.getState(), {
        tunnelDomain,
        controlBaseUrl,
        bindingId: searchParams.get("bindingId"),
        hostFingerprint: searchParams.get("hostFingerprint")
      })
    ).then(() => {
      if (cancelled) {
        return;
      }

      navigate(`/login?returnTo=${encodeURIComponent(returnTo)}`, {
        replace: true
      });
    }).catch(() => {
      if (!cancelled) {
        setErrorMessage(translate("auth.relayEntryInvalid"));
      }
    });

    return () => {
      cancelled = true;
    };
  }, [navigate, searchParams, translate, tunnelDomain]);

  return (
    <section>
      <h1>{t("auth.relayEntryTitle")}</h1>
      <p>{t("auth.relayEntryDescription")}</p>
      {errorMessage ? <p>{errorMessage}</p> : null}
      {!errorMessage ? <p>{t("common.loading")}</p> : null}
    </section>
  );
}

function normalizeReturnTo(value: string | null): string {
  const normalized = value?.trim();

  if (!normalized || !normalized.startsWith("/")) {
    return "/";
  }

  return normalized;
}
