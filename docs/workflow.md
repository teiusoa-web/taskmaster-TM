# TaskMaster Workflows

This document describes the workflows visible in the current UI and implemented by the client storage/auth modules. The browser flowcharts show the service boundaries; current task permissions are substantially client-side.

## 1. Task lifecycle

```mermaid
stateDiagram-v2
    [*] --> Pending: Manager/admin creates assignment
    [*] --> RequestPending: User submits task request
    RequestPending --> Pending: Manager/admin accepts and assigns
    RequestPending --> Cancelled: Manager/admin declines request
    Pending --> InProgress: Assignee accepts
    InProgress --> AwaitingReview: Assignee submits completion report
    NeedsRevision --> AwaitingReview: Assignee resubmits completion report
    AwaitingReview --> Completed: Admin approves report
    AwaitingReview --> NeedsRevision: Admin rejects report with comment
    InProgress --> Cancelled: Admin approves cancellation request
    Pending --> Cancelled: Admin approves cancellation request
    Cancelled --> InProgress: Work is reopened
    Completed --> NeedsRevision: Admin requests correction
```

Overdue is a derived view based on deadline and non-terminal status, not a stored status. Cancellation and deadline changes have request/review steps and can block completion review while pending. Recurring tasks may create a new pending task after approval of the current occurrence.

## 2. Create a task

```mermaid
sequenceDiagram
    actor M as Manager/admin
    participant UI as Task form
    participant Store as js/storage.js
    participant API as JSON Server
    participant DB as data/database.json
    M->>UI: Enter title, assignee, category, priority, deadline
    UI->>UI: Validate required fields
    UI->>Store: addTask(task)
    Store->>Store: Check client role and set owner/status/activity
    Store->>API: POST /tasks
    API->>DB: Persist task document
    API-->>Store: Created task
    Store-->>UI: Success or error
    UI-->>M: Show task in list/board
```

## 3. Work and request completion

```mermaid
flowchart TD
    A[Assignee opens pending task] --> B[Accept task]
    B --> C[Update subtasks, comments, or progress report]
    C --> D{Ready to submit?}
    D -->|No| C
    D -->|Yes| E[Submit completion report and attachments]
    E --> F[Status becomes awaiting-review]
    F --> G{Admin decision}
    G -->|Approve| H[Completed]
    G -->|Reject with comment| I[Needs revision]
    I --> C
```

## 4. Account access

```mermaid
sequenceDiagram
    actor U as User
    participant Page as Login/account page
    participant Auth as /auth handler
    participant File as data/users.json
    U->>Page: Submit credentials
    Page->>Auth: POST /auth/login
    Auth->>File: Read account and verify scrypt hash
    alt Valid active account
        Auth-->>Page: Set HTTP-only session cookie + safe profile
        Page->>Auth: GET /auth/me on later page loads
        Auth-->>Page: Current safe profile
    else Invalid credentials
        Auth-->>Page: Error response
    end
```

Password recovery and email verification are separate token-based routes. Email delivery uses configured SMTP in production; development can print preview links to the server console.

## 5. Failure paths and current boundaries

- Invalid form input remains on the form and displays validation feedback.
- Failed API writes are reported to the caller; some task operations optimistically update local state and attempt rollback. Cached data does not automatically synchronize later.
- If task/category reads fail, `Storage.init()` attempts the browser's localStorage cache.
- Upload failures return an error; successful uploads create both a primary file and a backup copy.
- Task authorization in the UI is not a security boundary while JSON Server is directly reachable. Enforce every transition in a trusted server API before public deployment.
