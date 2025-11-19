import { Meilisearch } from "meilisearch";

export default new Meilisearch({
  host: process.env.MEILI_HOST,
  apiKey: process.env.MEILI_MASTER_KEY,
});
