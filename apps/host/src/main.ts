import { installConsoleTimestampPrefix } from "./shared/utils/install-console-timestamp-prefix.js";
import { startHost } from "./server/start-host.js";

installConsoleTimestampPrefix();

await startHost();
