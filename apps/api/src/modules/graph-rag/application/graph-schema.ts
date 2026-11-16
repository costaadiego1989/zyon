import { GRAPH_SCHEMA_STATEMENTS } from "./graph-projection.service.js";
import { PUBLIC_BUSINESS_GRAPH_SCHEMA } from "./public-business-projection.service.js";

/** Operator/bootstrap capability only. Reader paths never execute schema DDL. */
export const ALL_GRAPH_SCHEMA_STATEMENTS: readonly string[] = Object.freeze([
  ...GRAPH_SCHEMA_STATEMENTS, ...PUBLIC_BUSINESS_GRAPH_SCHEMA,
]);
