// Base URL of the backend API in the CONTAINER build (`ng build --configuration container`).
// angular.json swaps this file in for api.config.ts. The address is empty (relative): the web server (nginx) that serves
// the app also forwards /api and /hubs to the API, so the browser sees ONE origin (no CORS, the refresh cookie just works).
export const API_BASE_URL = '';
