// Authenticated Express routes used by profiles, skills, projects, teams, chat, and notifications.
const crypto = require("crypto");
const express = require("express");
const { db } = require("./db");

const router = express.Router();

// Convert route and request values into safe positive database IDs.
function idFrom(value) {
    const id = Number(value);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
}

// Match a submitted bearer token against the hash stored in MySQL.
function tokenHash(token) {
    return crypto.createHash("sha256").update(token).digest("hex");
}

// Block private API routes unless the request has a valid, unexpired login session.
function requireAuth(req, res, next) {
    const authorization = req.get("authorization") || "";
    const match = authorization.match(/^Bearer\s+([a-f0-9]{64})$/i);

    if (!match) {
        return res.status(401).json({ success: false, message: "Please log in to continue." });
    }

    db.execute(
        "SELECT user_id FROM auth_sessions WHERE token_hash = ? AND expires_at > NOW()",
        [tokenHash(match[1])]
    ).then(([rows]) => {
        if (!rows.length) {
            return res.status(401).json({ success: false, message: "Your session has expired. Please log in again." });
        }

        req.userId = rows[0].user_id;
        next();
    }).catch(next);
}

// Shared lookups keep profile and project responses in the shape expected by the UI.
async function getSkillsFor(table, idColumn, id) {
    const [rows] = await db.execute(
        `SELECT s.id, s.name
         FROM ${table} link
         JOIN skills s ON s.id = link.skill_id
         WHERE link.${idColumn} = ?
         ORDER BY s.name`,
        [id]
    );
    return rows;
}

async function getProfile(userId) {
    const [rows] = await db.execute(
        `SELECT u.id, u.name, u.email, u.college,
                p.semester, p.bio, p.interests, p.profile_image
         FROM users u
         LEFT JOIN profiles p ON p.user_id = u.id
         WHERE u.id = ?`,
        [userId]
    );

    if (!rows.length) return null;
    return { ...rows[0], skills: (await getSkillsFor("user_skills", "user_id", userId)).map((skill) => skill.name) };
}

async function getProjectSummary(projectId, viewerId) {
    const [rows] = await db.execute(
        `SELECT p.*, u.name AS owner_name,
                (SELECT COUNT(*) FROM project_members pm WHERE pm.project_id = p.id) AS member_count,
                EXISTS(SELECT 1 FROM project_members pm WHERE pm.project_id = p.id AND pm.user_id = ?) AS is_member,
                EXISTS(SELECT 1 FROM applications a WHERE a.project_id = p.id AND a.actor_id = ? AND a.type = 'application' AND a.status = 'pending') AS has_pending
         FROM projects p
         JOIN users u ON u.id = p.owner_id
         WHERE p.id = ?`,
        [viewerId, viewerId, projectId]
    );

    if (!rows.length) return null;
    const project = rows[0];
    project.skills = await getSkillsFor("project_skills", "project_id", project.id);
    project.is_owner = Number(project.owner_id) === Number(viewerId);
    project.spots_left = Math.max(0, Number(project.team_size) - Number(project.member_count));
    project.members = await getProjectMembers(project.id);
    return project;
}

async function getProjectMembers(projectId) {
    const [members] = await db.execute(
        `SELECT u.id, u.name, p.profile_image, pm.role
         FROM project_members pm
         JOIN users u ON u.id = pm.user_id
         LEFT JOIN profiles p ON p.user_id = u.id
         WHERE pm.project_id = ?
         ORDER BY (pm.role = 'owner') DESC, u.name`,
        [projectId]
    );
    return members;
}

async function getProgress(projectId) {
    const [[counts]] = await db.execute(
        `SELECT COUNT(*) AS total, COALESCE(SUM(status = 'done'), 0) AS done
         FROM tasks WHERE project_id = ?`,
        [projectId]
    );
    const total = Number(counts.total);
    const done = Number(counts.done);
    return { total, done, percent: total ? Math.round(done * 100 / total) : 0 };
}

async function addNotification(userId, actorId, type, message, link) {
    if (Number(userId) === Number(actorId)) return;
    await db.execute(
        "INSERT INTO notifications (user_id, actor_id, type, message, link) VALUES (?, ?, ?, ?, ?)",
        [userId, actorId, type, message, link || "notifications.html"]
    );
}

async function matchingData(userId, project) {
    const [mine] = await db.execute(
        "SELECT s.id, s.name FROM user_skills us JOIN skills s ON s.id = us.skill_id WHERE us.user_id = ?",
        [userId]
    );
    const mineIds = new Set(mine.map((skill) => Number(skill.id)));
    const required = project.skills || await getSkillsFor("project_skills", "project_id", project.id);
    const matchedSkills = required.filter((skill) => mineIds.has(Number(skill.id))).map((skill) => skill.name);
    const missingSkills = required.filter((skill) => !mineIds.has(Number(skill.id))).map((skill) => skill.name);
    const skillPercent = required.length ? matchedSkills.length / required.length * 100 : 100;
    const percent = Math.round(skillPercent);

    return {
        percent,
        matchedSkills,
        missingSkills,
        explanation: required.length
            ? `${matchedSkills.length} of ${required.length} required skills match your profile.`
            : "This project has no specific required skills."
    };
}

// Public landing-page counters are available before the visitor signs in.
router.get("/stats", async (req, res) => {
    const [[stats]] = await db.query(
        `SELECT
            (SELECT COUNT(*) FROM projects WHERE status IN ('open', 'in_progress')) AS activeProjects,
            (SELECT COUNT(*) FROM applications WHERE status = 'accepted') AS projectsMatched,
            (SELECT COUNT(*) FROM projects p
             WHERE p.status IN ('open', 'in_progress')
               AND (SELECT COUNT(*) FROM project_members pm WHERE pm.project_id = p.id) < p.team_size) AS teamsForming`
    );
    res.json({
        activeProjects: Number(stats.activeProjects),
        projectsMatched: Number(stats.projectsMatched),
        teamsForming: Number(stats.teamsForming)
    });
});

// All routes below this point require a valid account session.
router.use(requireAuth);

// Profile endpoints read public profile cards and update the signed-in user's profile.
router.get("/profile", async (req, res) => {
    const profile = await getProfile(req.userId);
    if (!profile) return res.status(404).json({ message: "Profile not found." });
    res.json({ profile });
});

router.get("/profile/:id", async (req, res) => {
    const id = idFrom(req.params.id);
    if (!id) return res.status(400).json({ message: "Invalid profile ID." });
    const profile = await getProfile(id);
    if (!profile) return res.status(404).json({ message: "Profile not found." });
    res.json({ profile });
});

router.put("/profile", async (req, res) => {
    const { name, college, semester, bio, interests, profile_image: image } = req.body;
    const cleanName = String(name || "").trim();
    if (cleanName.length < 2 || cleanName.length > 100) {
        return res.status(400).json({ message: "Name must be between 2 and 100 characters." });
    }
    if (college && String(college).length > 150) return res.status(400).json({ message: "College is too long." });
    if (semester && String(semester).length > 30) return res.status(400).json({ message: "Semester is too long." });
    if (bio && String(bio).length > 1000) return res.status(400).json({ message: "Bio is too long." });
    if (interests && String(interests).length > 500) return res.status(400).json({ message: "Interests are too long." });
    if (image && (!/^https?:\/\//i.test(image) || String(image).length > 2048)) {
        return res.status(400).json({ message: "Enter a valid HTTP or HTTPS image URL." });
    }

    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();
        await connection.execute("UPDATE users SET name = ?, college = ? WHERE id = ?", [
            cleanName, college ? String(college).trim() : null, req.userId
        ]);
        await connection.execute(
            `INSERT INTO profiles (user_id, semester, bio, interests, profile_image)
             VALUES (?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE semester = VALUES(semester), bio = VALUES(bio),
                 interests = VALUES(interests), profile_image = VALUES(profile_image)`,
            [req.userId, semester || null, bio || null, interests || null, image || null]
        );
        await connection.commit();
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }

    res.json({ profile: await getProfile(req.userId) });
});

// Skills can be shared globally while each account stores its own selected skills.
router.get("/skills", async (req, res) => {
    const [skills] = await db.execute(
        `SELECT s.id, s.name, (us.user_id IS NOT NULL) AS selected
         FROM skills s
         LEFT JOIN user_skills us ON us.skill_id = s.id AND us.user_id = ?
         ORDER BY s.name`,
        [req.userId]
    );
    res.json({ skills });
});

router.post("/skills", async (req, res) => {
    const name = String(req.body.name || "").trim();
    if (!name || name.length > 80) return res.status(400).json({ message: "Skill name must be 1 to 80 characters." });
    const [result] = await db.execute("INSERT IGNORE INTO skills (name) VALUES (?)", [name]);
    const [[skill]] = await db.execute("SELECT id, name FROM skills WHERE name = ?", [name]);
    await db.execute("INSERT IGNORE INTO user_skills (user_id, skill_id) VALUES (?, ?)", [req.userId, skill.id]);
    res.status(result.affectedRows ? 201 : 200).json({ skill, created: Boolean(result.affectedRows) });
});

router.put("/skills/me", async (req, res) => {
    const ids = Array.isArray(req.body.skillIds) ? [...new Set(req.body.skillIds.map(idFrom).filter(Boolean))] : null;
    if (!ids) return res.status(400).json({ message: "skillIds must be an array of valid IDs." });
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();
        await connection.execute("DELETE FROM user_skills WHERE user_id = ?", [req.userId]);
        if (ids.length) {
            const values = ids.map(() => "(?, ?)").join(", ");
            await connection.execute(
                `INSERT INTO user_skills (user_id, skill_id) VALUES ${values}`,
                ids.flatMap((id) => [req.userId, id])
            );
        }
        await connection.commit();
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
    res.json({ success: true });
});

// Project routes support browsing, filtering, ownership, and member applications.
router.get("/projects/categories", async (req, res) => {
    const [rows] = await db.query("SELECT DISTINCT category FROM projects ORDER BY category");
    res.json({ categories: rows.map((row) => row.category) });
});

router.get("/projects/mine", async (req, res) => {
    const [rows] = await db.execute(
        `SELECT p.id, p.owner_id, p.title, p.status,
                EXISTS(SELECT 1 FROM project_members pm WHERE pm.project_id = p.id AND pm.user_id = ?) AS is_member,
                (p.owner_id = ?) AS is_owner
         FROM projects p
         JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ?
         ORDER BY p.created_at DESC`,
        [req.userId, req.userId, req.userId]
    );
    res.json({ projects: rows });
});

router.get("/projects", async (req, res) => {
    const filters = [];
    const values = [req.userId, req.userId];
    if (req.query.q) {
        filters.push("(p.title LIKE ? OR p.description LIKE ?)");
        values.push(`%${String(req.query.q).slice(0, 100)}%`, `%${String(req.query.q).slice(0, 100)}%`);
    }
    if (req.query.category) {
        filters.push("p.category = ?");
        values.push(String(req.query.category).slice(0, 60));
    }
    if (req.query.status && ["open", "in_progress", "completed"].includes(req.query.status)) {
        filters.push("p.status = ?");
        values.push(req.query.status);
    }
    if (req.query.skill) {
        filters.push("EXISTS (SELECT 1 FROM project_skills ps JOIN skills s ON s.id = ps.skill_id WHERE ps.project_id = p.id AND s.name = ?)");
        values.push(String(req.query.skill).slice(0, 80));
    }
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const [rows] = await db.execute(
        `SELECT p.id, p.owner_id, p.title, p.description, p.category, p.team_size, p.deadline,
                p.image_url, p.status, u.name AS owner_name,
                (SELECT COUNT(*) FROM project_members pm WHERE pm.project_id = p.id) AS member_count,
                EXISTS(SELECT 1 FROM project_members pm WHERE pm.project_id = p.id AND pm.user_id = ?) AS is_member,
                EXISTS(SELECT 1 FROM applications a WHERE a.project_id = p.id AND a.actor_id = ? AND a.type = 'application' AND a.status = 'pending') AS has_pending
         FROM projects p JOIN users u ON u.id = p.owner_id ${where}
         ORDER BY p.created_at DESC LIMIT 100`,
        values
    );
    for (const project of rows) {
        project.skills = await getSkillsFor("project_skills", "project_id", project.id);
        project.spots_left = Math.max(0, Number(project.team_size) - Number(project.member_count));
        project.is_owner = Number(project.owner_id) === Number(req.userId);
    }
    res.json({ projects: rows });
});

router.post("/projects", async (req, res) => {
    const { title, description, category, team_size: teamSize, deadline, image_url: imageUrl, skillIds } = req.body;
    const cleanTitle = String(title || "").trim();
    const cleanDescription = String(description || "").trim();
    const size = Number(teamSize);
    if (cleanTitle.length < 3 || cleanTitle.length > 150 || cleanDescription.length < 10 || cleanDescription.length > 5000) {
        return res.status(400).json({ message: "Enter a project title (3–150 characters) and description (10–5000 characters)." });
    }
    if (!Number.isInteger(size) || size < 2 || size > 20) return res.status(400).json({ message: "Team size must be between 2 and 20." });
    if (imageUrl && !/^https?:\/\//i.test(imageUrl)) return res.status(400).json({ message: "Image URL must start with http:// or https://." });
    const ids = Array.isArray(skillIds) ? [...new Set(skillIds.map(idFrom).filter(Boolean))] : [];

    const connection = await db.getConnection();
    let projectId;
    try {
        await connection.beginTransaction();
        const [result] = await connection.execute(
            `INSERT INTO projects (owner_id, title, description, category, team_size, deadline, image_url)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [req.userId, cleanTitle, cleanDescription, String(category || "General").trim().slice(0, 60) || "General", size, deadline || null, imageUrl || null]
        );
        projectId = result.insertId;
        await connection.execute("INSERT INTO project_members (project_id, user_id, role) VALUES (?, ?, 'owner')", [projectId, req.userId]);
        if (ids.length) {
            const placeholders = ids.map(() => "(?, ?)").join(", ");
            await connection.execute(
                `INSERT IGNORE INTO project_skills (project_id, skill_id) VALUES ${placeholders}`,
                ids.flatMap((id) => [projectId, id])
            );
        }
        await connection.commit();
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
    res.status(201).json({ project: await getProjectSummary(projectId, req.userId) });
});

router.get("/projects/:id", async (req, res) => {
    const id = idFrom(req.params.id);
    if (!id) return res.status(400).json({ message: "Invalid project ID." });
    const project = await getProjectSummary(id, req.userId);
    if (!project) return res.status(404).json({ message: "Project not found." });
    res.json({ project });
});

router.put("/projects/:id", async (req, res) => {
    const id = idFrom(req.params.id);
    if (!id) return res.status(400).json({ message: "Invalid project ID." });
    const [ownerRows] = await db.execute("SELECT owner_id FROM projects WHERE id = ?", [id]);
    if (!ownerRows.length) return res.status(404).json({ message: "Project not found." });
    if (Number(ownerRows[0].owner_id) !== Number(req.userId)) return res.status(403).json({ message: "Only the project owner can edit it." });

    const { title, description, category, team_size: teamSize, deadline, image_url: imageUrl, status, skillIds } = req.body;
    const cleanTitle = String(title || "").trim();
    const cleanDescription = String(description || "").trim();
    const size = Number(teamSize);
    if (cleanTitle.length < 3 || cleanTitle.length > 150 || cleanDescription.length < 10 || cleanDescription.length > 5000) {
        return res.status(400).json({ message: "Enter a project title (3–150 characters) and description (10–5000 characters)." });
    }
    if (!Number.isInteger(size) || size < 2 || size > 20) return res.status(400).json({ message: "Team size must be between 2 and 20." });
    if (!["open", "in_progress", "completed"].includes(status)) return res.status(400).json({ message: "Invalid project status." });
    if (imageUrl && !/^https?:\/\//i.test(imageUrl)) return res.status(400).json({ message: "Image URL must start with http:// or https://." });
    const ids = Array.isArray(skillIds) ? [...new Set(skillIds.map(idFrom).filter(Boolean))] : [];

    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();
        await connection.execute(
            `UPDATE projects SET title = ?, description = ?, category = ?, team_size = ?,
                deadline = ?, image_url = ?, status = ? WHERE id = ?`,
            [cleanTitle, cleanDescription, String(category || "General").trim().slice(0, 60) || "General", size, deadline || null, imageUrl || null, status, id]
        );
        await connection.execute("DELETE FROM project_skills WHERE project_id = ?", [id]);
        if (ids.length) {
            const placeholders = ids.map(() => "(?, ?)").join(", ");
            await connection.execute(
                `INSERT IGNORE INTO project_skills (project_id, skill_id) VALUES ${placeholders}`,
                ids.flatMap((skillId) => [id, skillId])
            );
        }
        await connection.commit();
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
    res.json({ project: await getProjectSummary(id, req.userId) });
});

router.delete("/projects/:id", async (req, res) => {
    const id = idFrom(req.params.id);
    if (!id) return res.status(400).json({ message: "Invalid project ID." });
    const [result] = await db.execute("DELETE FROM projects WHERE id = ? AND owner_id = ?", [id, req.userId]);
    if (!result.affectedRows) return res.status(404).json({ message: "Project not found or you are not its owner." });
    res.json({ success: true });
});

router.post("/projects/:id/apply", async (req, res) => {
    const id = idFrom(req.params.id);
    if (!id) return res.status(400).json({ message: "Invalid project ID." });
    const project = await getProjectSummary(id, req.userId);
    if (!project) return res.status(404).json({ message: "Project not found." });
    if (project.is_member) return res.status(409).json({ message: "You are already on this team." });
    if (project.is_owner) return res.status(400).json({ message: "You already own this project." });
    if (project.status === "completed" || project.spots_left < 1) return res.status(409).json({ message: "This project is not accepting members." });
    try {
        await db.execute(
            "INSERT INTO applications (project_id, actor_id, target_id, type) VALUES (?, ?, ?, 'application')",
            [id, req.userId, project.owner_id]
        );
    } catch (error) {
        if (error.code === "ER_DUP_ENTRY") return res.status(409).json({ message: "You already sent a request for this project." });
        throw error;
    }
    await addNotification(project.owner_id, req.userId, "join_request", `${(await getProfile(req.userId)).name} wants to join ${project.title}.`, `notifications.html`);
    res.status(201).json({ success: true });
});

// Matching ranks open projects and candidates using overlap with selected skills.
router.get("/matching/projects", async (req, res) => {
    const [rows] = await db.execute(
        `SELECT p.id, p.owner_id, p.title, p.description, p.category, p.team_size, p.status, u.name AS owner_name,
                (SELECT COUNT(*) FROM project_members pm WHERE pm.project_id = p.id) AS member_count,
                EXISTS(SELECT 1 FROM applications a WHERE a.project_id = p.id AND a.actor_id = ? AND a.type = 'application' AND a.status = 'pending') AS has_pending,
                EXISTS(SELECT 1 FROM project_members pm WHERE pm.project_id = p.id AND pm.user_id = ?) AS is_member
         FROM projects p JOIN users u ON u.id = p.owner_id
         WHERE p.status = 'open' AND p.owner_id <> ?
         ORDER BY p.created_at DESC LIMIT 100`,
        [req.userId, req.userId, req.userId]
    );
    const projects = [];
    for (const project of rows) {
        project.skills = await getSkillsFor("project_skills", "project_id", project.id);
        project.spots_left = Math.max(0, Number(project.team_size) - Number(project.member_count));
        if (project.spots_left && !project.is_member) {
            project.match = await matchingData(req.userId, project);
            projects.push(project);
        }
    }
    projects.sort((a, b) => b.match.percent - a.match.percent);
    res.json({ projects });
});

router.get("/matching/projects/:id/candidates", async (req, res) => {
    const id = idFrom(req.params.id);
    if (!id) return res.status(400).json({ message: "Invalid project ID." });
    const project = await getProjectSummary(id, req.userId);
    if (!project) return res.status(404).json({ message: "Project not found." });
    if (!project.is_owner) return res.status(403).json({ message: "Only the project owner can view candidates." });
    project.full = project.spots_left < 1;

    const [candidates] = await db.execute(
        `SELECT u.id, u.name, u.college, p.semester, p.profile_image,
                EXISTS(SELECT 1 FROM applications a WHERE a.project_id = ? AND a.target_id = u.id AND a.type = 'invite' AND a.status = 'pending') AS has_pending
         FROM users u LEFT JOIN profiles p ON p.user_id = u.id
         WHERE u.id <> ? AND u.id <> ? AND NOT EXISTS (
             SELECT 1 FROM project_members pm WHERE pm.project_id = ? AND pm.user_id = u.id
         )`,
        [id, req.userId, project.owner_id, id]
    );
    for (const candidate of candidates) candidate.match = await matchingData(candidate.id, project);
    candidates.sort((a, b) => b.match.percent - a.match.percent);
    res.json({ project, candidates });
});

// Invitations and join applications share a table and are accepted or rejected here.
router.get("/invitations", async (req, res) => {
    const [rows] = await db.execute(
        `SELECT a.id, a.project_id, a.actor_id, a.target_id, a.type, a.created_at, p.title AS project_title,
                sender.name AS sender_name, applicant.name AS applicant_name
         FROM applications a
         JOIN projects p ON p.id = a.project_id
         JOIN users sender ON sender.id = a.actor_id
         JOIN users applicant ON applicant.id = a.actor_id
         WHERE a.status = 'pending' AND (
             (a.type = 'invite' AND a.target_id = ?)
             OR (a.type = 'application' AND p.owner_id = ?)
         )
         ORDER BY a.created_at DESC`,
        [req.userId, req.userId]
    );
    res.json({ incoming: rows });
});

router.post("/invitations", async (req, res) => {
    const projectId = idFrom(req.body.projectId);
    const userId = idFrom(req.body.userId);
    if (!projectId || !userId) return res.status(400).json({ message: "A valid project and student are required." });
    const project = await getProjectSummary(projectId, req.userId);
    if (!project) return res.status(404).json({ message: "Project not found." });
    if (!project.is_owner) return res.status(403).json({ message: "Only the project owner can invite students." });
    if (project.spots_left < 1) return res.status(409).json({ message: "Your team is full." });
    const [candidate] = await db.execute("SELECT id, name FROM users WHERE id = ?", [userId]);
    if (!candidate.length || userId === Number(req.userId)) return res.status(404).json({ message: "Student not found." });
    try {
        await db.execute("INSERT INTO applications (project_id, actor_id, target_id, type) VALUES (?, ?, ?, 'invite')", [projectId, req.userId, userId]);
    } catch (error) {
        if (error.code === "ER_DUP_ENTRY") return res.status(409).json({ message: "An invitation is already pending or was already answered." });
        throw error;
    }
    await addNotification(userId, req.userId, "invitation", `${(await getProfile(req.userId)).name} invited you to join ${project.title}.`, "notifications.html");
    res.status(201).json({ success: true });
});

router.patch("/invitations/:id", async (req, res) => {
    const id = idFrom(req.params.id);
    const action = req.body.action;
    if (!id || !["accept", "reject"].includes(action)) return res.status(400).json({ message: "Invalid invitation action." });
    const connection = await db.getConnection();
    let application;
    try {
        await connection.beginTransaction();
        const [rows] = await connection.execute(
            `SELECT a.*, p.owner_id, p.title, p.team_size,
                    (SELECT COUNT(*) FROM project_members pm WHERE pm.project_id = p.id) AS member_count
             FROM applications a JOIN projects p ON p.id = a.project_id
             WHERE a.id = ? AND a.status = 'pending' FOR UPDATE`,
            [id]
        );
        if (!rows.length) {
            await connection.rollback();
            return res.status(404).json({ message: "Pending request not found." });
        }
        application = rows[0];
        const allowed = application.type === "invite"
            ? Number(application.target_id) === Number(req.userId)
            : Number(application.owner_id) === Number(req.userId);
        if (!allowed) {
            await connection.rollback();
            return res.status(403).json({ message: "You cannot respond to this request." });
        }
        const status = action === "accept" ? "accepted" : "rejected";
        if (action === "accept" && Number(application.member_count) >= Number(application.team_size)) {
            await connection.rollback();
            return res.status(409).json({ message: "The team is already full." });
        }
        await connection.execute("UPDATE applications SET status = ? WHERE id = ?", [status, id]);
        if (action === "accept") {
            const memberId = application.type === "invite" ? application.target_id : application.actor_id;
            await connection.execute("INSERT IGNORE INTO project_members (project_id, user_id, role) VALUES (?, ?, 'member')", [application.project_id, memberId]);
        }
        await connection.commit();
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
    const otherUserId = application.type === "invite" ? application.actor_id : application.actor_id;
    await addNotification(otherUserId, req.userId, "invitation_response", `Your request for ${application.title} was ${action === "accept" ? "accepted" : "rejected"}.`, `team.html?id=${application.project_id}`);
    res.json({ status: action === "accept" ? "accepted" : "rejected" });
});

// Notification endpoints list updates and mark one or all updates as read.
router.get("/notifications/unread-count", async (req, res) => {
    const [[row]] = await db.execute("SELECT COUNT(*) AS unread FROM notifications WHERE user_id = ? AND is_read = 0", [req.userId]);
    res.json({ unread: Number(row.unread) });
});

router.get("/notifications", async (req, res) => {
    const [notifications] = await db.execute(
        `SELECT id, type, message, link, is_read, created_at
         FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 100`,
        [req.userId]
    );
    const unread = notifications.reduce((count, item) => count + (item.is_read ? 0 : 1), 0);
    res.json({ notifications, unread });
});

router.patch("/notifications/:id/read", async (req, res) => {
    const id = idFrom(req.params.id);
    if (!id) return res.status(400).json({ message: "Invalid notification ID." });
    await db.execute("UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?", [id, req.userId]);
    res.json({ success: true });
});

router.post("/notifications/read-all", async (req, res) => {
    await db.execute("UPDATE notifications SET is_read = 1 WHERE user_id = ?", [req.userId]);
    res.json({ success: true });
});

// Team endpoints return members, shared skills, task lists, and task progress.
router.get("/teams/:projectId", async (req, res) => {
    const projectId = idFrom(req.params.projectId);
    if (!projectId) return res.status(400).json({ message: "Invalid project ID." });
    const project = await getProjectSummary(projectId, req.userId);
    if (!project) return res.status(404).json({ message: "Project not found." });
    if (!project.is_member) return res.status(403).json({ message: "You are not a member of this team." });
    const members = project.members;
    const memberIds = members.map((member) => member.id);
    const memberSkills = new Map();
    for (const memberId of memberIds) {
        for (const skill of await getSkillsFor("user_skills", "user_id", memberId)) memberSkills.set(skill.id, skill.name);
    }
    const requiredSkills = project.skills.map((skill) => skill.name);
    const covered = requiredSkills.filter((name) => [...memberSkills.values()].includes(name)).length;
    const [tasks] = await db.execute(
        `SELECT t.id, t.title, t.status, t.assigned_to, u.name AS assigned_name
         FROM tasks t LEFT JOIN users u ON u.id = t.assigned_to
         WHERE t.project_id = ? ORDER BY t.created_at, t.id`,
        [projectId]
    );
    const progress = await getProgress(projectId);
    res.json({
        project,
        members,
        teamSkills: [...memberSkills.values()],
        requiredSkills,
        skillCoverage: { covered, total: requiredSkills.length, percent: requiredSkills.length ? Math.round(covered * 100 / requiredSkills.length) : 100 },
        tasks,
        progress
    });
});

async function getTaskProject(taskId) {
    const [rows] = await db.execute("SELECT project_id FROM tasks WHERE id = ?", [taskId]);
    return rows[0] || null;
}

router.post("/projects/:id/tasks", async (req, res) => {
    const projectId = idFrom(req.params.id);
    const title = String(req.body.title || "").trim();
    const assignedTo = req.body.assigned_to ? idFrom(req.body.assigned_to) : null;
    if (!projectId || title.length < 2 || title.length > 200) return res.status(400).json({ message: "Enter a task title between 2 and 200 characters." });
    const [membership] = await db.execute("SELECT role FROM project_members WHERE project_id = ? AND user_id = ?", [projectId, req.userId]);
    if (!membership.length) return res.status(403).json({ message: "You are not a member of this team." });
    if (assignedTo) {
        const [assignee] = await db.execute("SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?", [projectId, assignedTo]);
        if (!assignee.length) return res.status(400).json({ message: "Assigned student must be a team member." });
    }
    const [result] = await db.execute("INSERT INTO tasks (project_id, title, assigned_to) VALUES (?, ?, ?)", [projectId, title, assignedTo]);
    res.status(201).json({ task: { id: result.insertId, title, assigned_to: assignedTo, status: "todo" } });
});

router.patch("/tasks/:id", async (req, res) => {
    const id = idFrom(req.params.id);
    const status = req.body.status;
    if (!id || !["todo", "done"].includes(status)) return res.status(400).json({ message: "Invalid task status." });
    const task = await getTaskProject(id);
    if (!task) return res.status(404).json({ message: "Task not found." });
    const [membership] = await db.execute("SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?", [task.project_id, req.userId]);
    if (!membership.length) return res.status(403).json({ message: "You are not a member of this team." });
    await db.execute("UPDATE tasks SET status = ? WHERE id = ?", [status, id]);
    res.json({ progress: await getProgress(task.project_id) });
});

router.delete("/tasks/:id", async (req, res) => {
    const id = idFrom(req.params.id);
    if (!id) return res.status(400).json({ message: "Invalid task ID." });
    const task = await getTaskProject(id);
    if (!task) return res.status(404).json({ message: "Task not found." });
    const [membership] = await db.execute("SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?", [task.project_id, req.userId]);
    if (!membership.length) return res.status(403).json({ message: "You are not a member of this team." });
    await db.execute("DELETE FROM tasks WHERE id = ?", [id]);
    res.json({ progress: await getProgress(task.project_id) });
});

// Chat uses stored messages and polling; each conversation is limited to its two participants.
router.get("/chat/contacts", async (req, res) => {
    const q = String(req.query.q || "").trim().slice(0, 100);
    const [contacts] = await db.execute(
        `SELECT u.id, u.name, p.profile_image,
                (SELECT m.body FROM messages m
                 WHERE (m.sender_id = u.id AND m.recipient_id = ?) OR (m.sender_id = ? AND m.recipient_id = u.id)
                 ORDER BY m.id DESC LIMIT 1) AS last_message
         FROM users u LEFT JOIN profiles p ON p.user_id = u.id
         WHERE u.id <> ? AND (? = '' OR u.name LIKE ? OR u.email LIKE ?)
         ORDER BY u.name LIMIT 100`,
        [req.userId, req.userId, req.userId, q, `%${q}%`, `%${q}%`]
    );
    for (const contact of contacts) contact.online = false;
    res.json({ contacts });
});

router.get("/chat/with/:userId/messages", async (req, res) => {
    const userId = idFrom(req.params.userId);
    if (!userId || userId === Number(req.userId)) return res.status(400).json({ message: "Invalid conversation." });
    const after = Math.max(0, Number(req.query.after) || 0);
    const [messages] = await db.execute(
        `SELECT id, sender_id, recipient_id, body, created_at
         FROM messages
         WHERE ((sender_id = ? AND recipient_id = ?) OR (sender_id = ? AND recipient_id = ?)) AND id > ?
         ORDER BY id LIMIT 200`,
        [req.userId, userId, userId, req.userId, after]
    );
    res.json({ messages });
});

router.post("/chat/with/:userId/messages", async (req, res) => {
    const userId = idFrom(req.params.userId);
    const body = String(req.body.body || "").trim();
    if (!userId || userId === Number(req.userId)) return res.status(400).json({ message: "Invalid recipient." });
    if (!body || body.length > 2000) return res.status(400).json({ message: "Message must be between 1 and 2000 characters." });
    const [recipients] = await db.execute("SELECT id FROM users WHERE id = ?", [userId]);
    if (!recipients.length) return res.status(404).json({ message: "Student not found." });
    const [result] = await db.execute("INSERT INTO messages (sender_id, recipient_id, body) VALUES (?, ?, ?)", [req.userId, userId, body]);
    const [[message]] = await db.execute("SELECT id, sender_id, recipient_id, body, created_at FROM messages WHERE id = ?", [result.insertId]);
    res.status(201).json({ message });
});

// Return a helpful JSON 404 for API paths that do not have a matching route.
router.use((req, res) => {
    res.status(404).json({ success: false, message: `API endpoint not found: ${req.method} ${req.originalUrl}` });
});

module.exports = router;
