import { DesktopModal } from "../../../../components/DesktopModal";
import { ModalSection } from "../../../../components/ModalAtoms";
import { t } from "../../../../shared/i18n";
import type { TeableRuntimeFieldDto } from "../api/teable-runtime-api";
import { TeableFormView } from "../views/TeableFormView";
import type { TeableFormFieldDisplayConfig } from "../utils/teable-form-view-config";

export function TeableCreateRecordModal({
  open,
  tableId,
  tableName,
  fields,
  fieldOrder,
  visibleFieldIds,
  requiredFieldIds,
  fieldDisplay,
  onClose,
  onCreated
}: {
  open: boolean;
  tableId: string;
  tableName: string;
  fields: TeableRuntimeFieldDto[];
  fieldOrder?: string[];
  visibleFieldIds?: string[];
  requiredFieldIds?: string[];
  fieldDisplay?: Record<string, TeableFormFieldDisplayConfig>;
  onClose: () => void;
  onCreated: () => Promise<void> | void;
}) {
  return (
    <DesktopModal
      open={open}
      title={t("shell.teableRuntimeCreateRecordModalTitle")}
      description={t("shell.teableRuntimeCreateRecordModalDescription", { table: tableName })}
      size="regular"
      layout="form"
      onClose={onClose}
    >
      <ModalSection
        heading={t("shell.teableRuntimeCreateRecordFieldsTitle")}
        description={t("shell.teableRuntimeCreateRecordFieldsDescription")}
      >
        <TeableFormView
          tableId={tableId}
          fields={fields}
          fieldOrder={fieldOrder}
          visibleFieldIds={visibleFieldIds}
          requiredFieldIds={requiredFieldIds}
          fieldDisplay={fieldDisplay}
          onCreated={async () => {
            await onCreated();
            onClose();
          }}
        />
      </ModalSection>
    </DesktopModal>
  );
}
