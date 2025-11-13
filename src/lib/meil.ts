import { Meilisearch } from "meilisearch";

export default new Meilisearch({
  host: process.env.MELI_HOST,
  apiKey: process.env.MELI_MASTER_KEY,
});
