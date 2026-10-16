# ProjectHub

ProjectHub is a student collaboration web application where students can publish projects, find teammates, and work together to manage shared projects.

## Features

- Register, log in, and log out
- Create a student profile with college, semester, bio, interests, and skills
- Browse and search projects; filter by category, skill, and status
- Create, edit, and delete projects with required skills, team size, and deadline
- View project skill-match percentages based on profile skills
- Apply to join projects or invite other students to a team
- Accept or reject join requests and invitations
- View team members, shared and required skills, tasks, and project progress
- Chat one-to-one with other students
- Receive notifications and track unread notifications
- View project statistics on the public landing page

## Technology stack

- **Frontend:** HTML, CSS, and vanilla JavaScript
- **Backend:** Node.js and Express
- **Database:** MySQL
- **Other dependencies:** `mysql2`, `bcryptjs`, and `dotenv`

Express serves the frontend pages and connects the frontend to MySQL through the `/api` routes. On startup, the backend creates the database and required tables if they do not already exist.

## Requirements

- Node.js and npm
- A MySQL server. On Windows, you can use MySQL through XAMPP.

## Local setup (Windows)

1. Open a terminal in the project folder and install the dependencies:

   ```powershell
   npm install
   ```

2. Create a local copy of the environment configuration:

   ```powershell
   Copy-Item backend\.env.example backend\.env
   ```

3. Set your MySQL connection details in `backend\.env`:

   ```dotenv
   PORT=3000
   DB_HOST=127.0.0.1
   DB_PORT=3306
   DB_USER=root
   DB_PASSWORD=
   DB_NAME=projecthub_db
   ```

   If your MySQL user has a password, enter it as `DB_PASSWORD`. Keep `.env` for local configuration and do not share or commit it to a public repository.

4. Start **MySQL** from the XAMPP Control Panel, or make sure your MySQL server is running.

5. Start the application:

   ```powershell
   npm start
   ```

   The server will run at `http://localhost:3000`. Open this URL in your browser to use the app. On its first startup, the backend creates the database specified by `DB_NAME` and its tables.

## Demo data (optional)

The demo seeder adds sample profile information, teammates, projects, tasks, requests, notifications, and messages to an existing account.

1. Register an account in the app.
2. Find your account ID in MySQL or phpMyAdmin:

   ```sql
   SELECT id, name, email FROM users;
   ```

3. Run the seeder from the project root, replacing `1` with your account ID:

   ```powershell
   npm.cmd run seed:demo -- 1
   ```

The seeder adds sample data only once per account. Sample records are marked with `(Sample)` in their names. Sample teammate accounts receive randomly generated passwords and cannot be used to log in.

## Useful URLs

- Application: `http://localhost:3000`
- Backend health check: `http://localhost:3000/api/health`
- Database connection check: `http://localhost:3000/api/db-test`

When the database connection succeeds, `/api/db-test` returns the name of the connected MySQL database.

## API overview

Feature endpoints are available under `/api`. After login, the browser sends a bearer token with API requests. All endpoints except public statistics and health checks require a valid session.

| Area | Routes |
|---|---|
| Health and statistics | `GET /api/health`, `GET /api/db-test`, `GET /api/stats` |
| Authentication | `POST /api/auth/register`, `POST /api/auth/login` |
| Profile | `GET /api/profile`, `GET /api/profile/:id`, `PUT /api/profile` |
| Skills | `GET /api/skills`, `POST /api/skills`, `PUT /api/skills/me` |
| Projects | `GET /api/projects`, `GET /api/projects/mine`, `GET /api/projects/categories`, `GET /api/projects/:id`, `POST /api/projects`, `PUT /api/projects/:id`, `DELETE /api/projects/:id`, `POST /api/projects/:id/apply` |
| Matching and invitations | `GET /api/matching/projects`, `GET /api/matching/projects/:id/candidates`, `GET /api/invitations`, `POST /api/invitations`, `PATCH /api/invitations/:id` |
| Teams and tasks | `GET /api/teams/:projectId`, `POST /api/projects/:id/tasks`, `PATCH /api/tasks/:id`, `DELETE /api/tasks/:id` |
| Notifications | `GET /api/notifications`, `GET /api/notifications/unread-count`, `PATCH /api/notifications/:id/read`, `POST /api/notifications/read-all` |
| Chat | `GET /api/chat/contacts`, `GET /api/chat/with/:userId/messages`, `POST /api/chat/with/:userId/messages` |

`GET /api/projects` accepts the optional `q`, `category`, `skill`, and `status` filters. Supported project statuses are `open`, `in_progress`, and `completed`. The server checks permissions for project edits and deletions, invitation actions, and team tasks.

## Project structure

```text
PROJECT HUB/
├── backend/
│   ├── .env.example       # Template for MySQL and port settings
│   ├── api-routes.js      # Profile, project, team, chat, and other API routes
│   ├── db.js              # MySQL pool and schema initialization
│   ├── seed-demo.js       # Optional sample data seeder
│   └── server.js          # Express server and authentication endpoints
├── frontend/
│   ├── css/style.css
│   ├── images/
│   ├── js/                # Browser-side API and feature logic
│   └── *.html             # Application pages
├── package.json
└── README.md
```

## Troubleshooting

- **MySQL connection error:** Check that MySQL is running in XAMPP, then verify the host, port, username, and password in `backend\.env`.
- **Port 3000 is already in use:** Set `PORT` to an available port in `backend\.env`, then restart the server.
- **The browser cannot reach the server:** Make sure `npm start` is still running and open the app at `http://localhost:3000`.
- **Database test fails:** Open `http://localhost:3000/api/db-test` and check the database error reported in the server terminal.
