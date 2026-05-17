export const CODINGNS_OPENCLI_BLOCK_BROWSER_DEPENDENT_COMMANDS_ENV =
  "CODINGNS_OPENCLI_BLOCK_BROWSER_DEPENDENT_COMMANDS";

export function shouldBlockBrowserDependentOpenCliCommands(
  env: NodeJS.ProcessEnv
): boolean {
  return /^(1|true|yes)$/i.test(
    (env[CODINGNS_OPENCLI_BLOCK_BROWSER_DEPENDENT_COMMANDS_ENV] ?? "").trim()
  );
}
