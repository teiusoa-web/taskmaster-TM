# TaskMaster API Document

This describes routes present in the current local prototype. Responses and exact validation can vary by route. Task/category CRUD is provided directly by JSON Server; those endpoints do not enforce the application's client-side role rules. Do not publish this API as-is.

## 1. Services

| Service | Default address | Purpose |
|---|---|---|
| Web and auth | `http://localhost:3000` | Static pages and `/auth/*`. |
| JSON Server | `http://localhost:3001` | Tasks and categories REST resources. |
| Upload | `http://localhost:3002` | Upload endpoint and health check. |

The browser uses configured bases in `public/js/api-config.js`. Auth session calls use cookies; browser requests include credentials through the auth client.

## 2. Authentication routes

All routes are handled by `scripts/auth-server.cjs`. JSON request/response bodies use UTF-8. Authentication failures return an error response; sensitive hash/token fields are omitted from user profiles.

| Method and path | Purpose |
|---|---|
| `POST /auth/login` | Validate credentials and establish session cookie. |
| `POST /auth/logout` | End the current session and clear cookie. |
| `GET /auth/me` | Return current session user's safe profile. |
| `GET /auth/users` | List user profiles allowed by the handler. |
| `POST /auth/users` | Create an account (authorized roles only). |
| `PUT /auth/users/:id` | Update an account (authorized roles only). |
| `POST /auth/forgot-password` | Start password recovery; avoid revealing whether an email exists. |
| `POST /auth/reset-password` | Set a new password using a valid recovery token. |
| `POST /auth/request-email-verification` | Request verification email. |
| `POST /auth/verify-email` | Verify email using a valid token. |
| `POST /auth/change-password` | Change password for an authenticated user. |

Login and account routes set/clear an HTTP-only `tm_session` cookie. The current session store is in memory and sessions expire after inactivity; restarting the process invalidates sessions.

## 3. Task and category routes

Provided by JSON Server against `data/database.json`:

| Method and path | Purpose |
|---|---|
| `GET /tasks` | List task documents; supports JSON Server filters such as `?status=eq.pending`. |
| `GET /tasks/:id` | Read one task. |
| `POST /tasks` | Create task document. |
| `PUT /tasks/:id` | Replace task document. |
| `PATCH /tasks/:id` | Partially update a task. |
| `DELETE /tasks/:id` | Delete a task. |
| `GET /categories` | List categories. |
| `GET /categories/:id` | Read one category. |
| `POST /categories` | Create category. |
| `PUT /categories/:id` | Replace category. |
| `PATCH /categories/:id` | Partially update category. |
| `DELETE /categories/:id` | Delete category. |

These are generic CRUD endpoints, not domain-specific transition commands. The browser's `js/storage.js` coordinates operations and checks permissions, but callers can bypass those checks by reaching JSON Server directly.

## 4. Upload routes

| Method and path | Purpose |
|---|---|
| `GET /health` | Returns service health/version. |
| `POST /upload` | Upload avatar or attachment using JSON body `{ "kind": "avatar"|"attachment", "name": "...", "type": "MIME", "data": "BASE64" }`. |

Successful upload returns `201` with `{ id, name, type, size, url }`. Avatars accept supported image formats up to 5 MB; attachments accept supported image/document formats up to 25 MB. The endpoint currently has permissive CORS and no session authorization; secure it before external deployment.

## 5. Error handling and conventions

- Use standard HTTP methods and JSON. IDs are URL-encoded by the browser client.
- Auth errors include a JSON `error` message; upload errors use `{ "error": "..." }`.
- JSON Server returns its generic HTTP errors and does not apply the app's business validation.
- Dates are ISO timestamps or `YYYY-MM-DD` deadline strings, depending on field.

## 6. Recommended API evolution

For a server-enforced production API, expose task commands such as `POST /tasks/:id/accept`, `POST /tasks/:id/completion-submissions`, and `POST /tasks/:id/reviews`. Validate allowed status transitions, role, ownership, and request concurrency on the server. These command routes are recommendations and are not implemented by the current code.
