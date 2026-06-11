import { api } from "./api.js";
import { localApi } from "./localStore.js";

// Choose the backend at build time. Static deploys (GitHub Pages) set
// VITE_AA_LOCAL=1 to run the engine entirely in the browser (hot-seat play);
// otherwise the app talks to the play-by-cloud server over /api.
export const LOCAL = import.meta.env.VITE_AA_LOCAL === "1";
export const backend = LOCAL ? localApi : api;
