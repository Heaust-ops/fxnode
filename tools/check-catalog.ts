import { CATALOG_NODE_IDS, CATALOG_SCOPE } from "../src/catalog/scope.js";

const ids = [...CATALOG_NODE_IDS];
if (new Set(ids).size !== ids.length) {
  throw new Error(`Catalog IDs must be unique; found ${ids.length}/${new Set(ids).size}.`);
}
const scoped = Object.values(CATALOG_SCOPE).flat();
if (scoped.length !== ids.length || scoped.some(id => !ids.includes(id))) throw new Error("Catalog scope must exactly cover declared IDs");
console.log(`catalog: ${ids.length} unique IDs across ${Object.keys(CATALOG_SCOPE).length} domains`);
