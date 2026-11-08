// The dev/prod web server proxies these routes to its internal services.
// Using the current origin keeps API and upload calls on the deployed host.
export const API_BASE = window.location.origin;
export const UPLOAD_BASE = window.location.origin;
