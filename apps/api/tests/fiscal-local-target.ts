export const LOCAL_FISCAL_FIXTURE_DATABASE = "postgresql://fiscal:fiscal_local_only_20261114@127.0.0.1:25432/zyon_fiscal";
export const CI_FISCAL_FIXTURE_DATABASE = "postgresql://fiscal:fiscal_ci_local_only@127.0.0.1:5432/zyon_fiscal";

/** The expected target is fixed by the executor, never by the supplied DSN. */
export function fiscalFixtureDatabaseTarget(githubActions = process.env.GITHUB_ACTIONS): string {
  return githubActions === "true" ? CI_FISCAL_FIXTURE_DATABASE : LOCAL_FISCAL_FIXTURE_DATABASE;
}
