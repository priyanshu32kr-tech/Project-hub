// Express entry point: loads local configuration, connects APIs, and serves the browser app.
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const crypto = require("crypto");
const express = require("express");
const bcrypt = require("bcryptjs");
const { db, initializeDatabase } = require("./db");
const apiRoutes = require("./api-routes");

const app = express();
const PORT = process.env.PORT || 3000;

// Store only a hash of the login token so a database leak does not expose active tokens.
async function createSession(userId) {
    const token = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    await db.execute("DELETE FROM auth_sessions WHERE expires_at <= NOW()");
    await db.execute(
        "INSERT INTO auth_sessions (token_hash, user_id, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 30 DAY))",
        [tokenHash, userId]
    );
    return token;
}

// Parse browser requests, allow local development origins, and serve only frontend assets.
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use((req, res, next) => {
    const origin = req.get("origin");
    if (!origin || origin === "null" || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) {
        res.setHeader("Access-Control-Allow-Origin", origin || "*");
        res.setHeader("Vary", "Origin");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    }
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
});

app.use(["/server.js", "/db.js", "/package.json"], (req, res) => {
   res.sendStatus(404);
});
app.use(express.static(path.join(__dirname, "..", "frontend"), { dotfiles: "deny" }));

// Public health checks help confirm that the Node server and MySQL are reachable.
app.get("/api/health", (req, res) => {
    res.json({
        success: true,
        message: "ProjectHub backend is running"
    });
});

app.get("/api/db-test", async (req, res) => {
    try {
        const [rows] = await db.query(
            "SELECT DATABASE() AS database_name"
        );

        res.json({
            success: true,
            message: "MySQL connected successfully",
            database: rows[0].database_name
        });
    } catch (error) {
        console.error("Database error:", error.message);

        res.status(500).json({
            success: false,
            message: "Database connection failed"
        });
    }
});

// Validate new account details, hash the password, then create a persistent login session.
app.post(["/api/auth/register", "/api/register"], async (req, res) => {
    try {
        const { name, email, password, college } = req.body;

        if (!name || !email || !password) {
            return res.status(400).json({
                success: false,
                message: "Name, email and password are required"
            });
        }

        const cleanName = String(name).trim();
        const cleanEmail = String(email).trim().toLowerCase();
        const cleanCollege = college
            ? String(college).trim()
            : null;

        if (
            !cleanName ||
            cleanName.length > 100 ||
            cleanEmail.length > 150 ||
            !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail) ||
            String(password).length < 8 ||
            Buffer.byteLength(String(password), "utf8") > 72
        ) {
            return res.status(400).json({
                success: false,
                message: "Please enter valid details and a password of at least 8 characters"
            });
        }

        const [existing] = await db.execute(
            "SELECT id FROM users WHERE email = ?",
            [cleanEmail]
        );

        if (existing.length > 0) {
            return res.status(409).json({
                success: false,
                message: "Email already registered"
            });
        }

        const hashedPassword = await bcrypt.hash(
            String(password),
            12
        );

        const [result] = await db.execute(
            `INSERT INTO users (name, email, password, college)
             VALUES (?, ?, ?, ?)`,
            [cleanName, cleanEmail, hashedPassword, cleanCollege]
        );

        res.status(201).json({
            success: true,
            message: "Registration successful",
            token: await createSession(result.insertId),
            user: {
                id: result.insertId,
                name: cleanName,
                email: cleanEmail,
                college: cleanCollege
            }
        });

    } catch (error) {
        console.error("Registration error:", error.message);

        if (error.code === "ER_DUP_ENTRY") {
            return res.status(409).json({
                success: false,
                message: "Email already registered"
            });
        }

        res.status(500).json({
            success: false,
            message: "Registration failed"
        });
    }
});

// Look up the account, verify its password, and return a persistent login session.
app.post(["/api/auth/login", "/api/login"], async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({
                success: false,
                message: "Email and password are required"
            });
        }

        const cleanEmail = String(email).trim().toLowerCase();

        const [users] = await db.execute(
            `SELECT id, name, email, password, college
             FROM users
             WHERE email = ?`,
            [cleanEmail]
        );

        if (users.length === 0) {
            return res.status(401).json({
                success: false,
                message: "Invalid email or password"
            });
        }

        const user = users[0];

        const validPassword = await bcrypt.compare(
            String(password),
            user.password
        );

        if (!validPassword) {
            return res.status(401).json({
                success: false,
                message: "Invalid email or password"
            });
        }

        res.json({
            success: true,
            message: "Login successful",
            token: await createSession(user.id),
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                college: user.college
            }
        });

    } catch (error) {
        console.error("Login error:", error.message);

        res.status(500).json({
            success: false,
            message: "Login failed"
        });
    }
});

// Feature endpoints live in a separate router; unexpected errors are returned as JSON.
app.use("/api", apiRoutes);
app.use((error, req, res, next) => {
    console.error("API error:", error.message);
    if (res.headersSent) return next(error);
    res.status(500).json({ success: false, message: "An unexpected server error occurred." });
});

// Prepare the XAMPP database before accepting requests from the frontend.
async function start() {
    try {
        await initializeDatabase();
        app.listen(PORT, () => {
            console.log(`ProjectHub backend running at http://localhost:${PORT}`);
            console.log("MySQL database connection is ready.");
        });
    } catch (error) {
        console.error("Could not connect to MySQL:", error.message);
        console.error("Start MySQL in XAMPP and check backend/.env settings.");
        process.exitCode = 1;
    }
}

start();
