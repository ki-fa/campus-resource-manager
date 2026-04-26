import { connectToDatabase, isDatabaseConfigured } from "./db.js";

const userCollectionName = "users";
let indexesPromise = null;

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function trimOptionalString(value, maxLength) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().slice(0, maxLength);
}

function normalizeInterests(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => trimOptionalString(item, 40))
    .filter(Boolean)
    .slice(0, 12);
}

function sanitizeUserProfile(body) {
  if (Object.hasOwn(body || {}, "password")) {
    const error = new Error("Passwords are not accepted by this profile endpoint.");
    error.statusCode = 400;
    throw error;
  }

  const email = normalizeEmail(body?.email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    const error = new Error("A valid email address is required.");
    error.statusCode = 400;
    throw error;
  }

  return {
    email,
    displayName: trimOptionalString(body.displayName, 80),
    major: trimOptionalString(body.major, 80),
    graduationTerm: trimOptionalString(body.graduationTerm, 40),
    interests: normalizeInterests(body.interests),
    updatedAt: new Date()
  };
}

function serializeUser(user) {
  return {
    id: user._id.toString(),
    email: user.email,
    displayName: user.displayName || "",
    major: user.major || "",
    graduationTerm: user.graduationTerm || "",
    interests: user.interests || [],
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  };
}

async function ensureUserIndexes(database) {
  if (!indexesPromise) {
    indexesPromise = database.collection(userCollectionName).createIndex(
      { email: 1 },
      {
        unique: true,
        name: "unique_user_email"
      }
    );
  }

  return indexesPromise;
}

export function registerUserRoutes(app) {
  app.get("/api/users/status", (_request, response) => {
    response.json({
      configured: isDatabaseConfigured(),
      collection: userCollectionName
    });
  });

  app.post("/api/users/profiles", async (request, response, next) => {
    try {
      if (!isDatabaseConfigured()) {
        response.status(503).json({ message: "MongoDB is not configured for this server." });
        return;
      }

      const database = await connectToDatabase();
      await ensureUserIndexes(database);

      const profile = sanitizeUserProfile(request.body);
      const user = await database.collection(userCollectionName).findOneAndUpdate(
        { email: profile.email },
        {
          $set: profile,
          $setOnInsert: {
            createdAt: new Date()
          }
        },
        {
          upsert: true,
          returnDocument: "after"
        }
      );

      response.json({ user: serializeUser(user) });
    } catch (error) {
      next(error);
    }
  });
}
