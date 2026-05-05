import crypto from "crypto";
import { promisify } from "util";
import { ObjectId } from "mongodb";
import { connectToDatabase, isDatabaseConfigured } from "./db.js";

const scrypt = promisify(crypto.scrypt);
const userCollectionName = "users";
const passwordAlgorithm = "scrypt";
const passwordKeyLength = 64;
const minPasswordLength = 8;
const maxPasswordLength = 64;
const tokenTtlSeconds = 60 * 60 * 24 * 7;
const isProduction = process.env.NODE_ENV === "production";

let indexesPromise = null;

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function trimRequiredString(value, fieldLabel, maxLength) {
  const trimmed = typeof value === "string" ? value.trim() : "";

  if (!trimmed) {
    const error = new Error(`${fieldLabel} is required.`);
    error.statusCode = 400;
    throw error;
  }

  return trimmed.slice(0, maxLength);
}

function validateEmail(email) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    const error = new Error("A valid email address is required.");
    error.statusCode = 400;
    throw error;
  }
}

function validatePassword(password) {
  if (typeof password !== "string" || password.length < minPasswordLength) {
    const error = new Error(`Password must be at least ${minPasswordLength} characters.`);
    error.statusCode = 400;
    throw error;
  }

  if (password.length > maxPasswordLength) {
    const error = new Error(`Password must be at most ${maxPasswordLength} characters.`);
    error.statusCode = 400;
    throw error;
  }
}

function sanitizeRegistration(body = {}) {
  const firstName = trimRequiredString(body.firstName || body.fName, "First name", 50);
  const lastName = trimRequiredString(body.lastName || body.lName, "Last name", 50);
  const email = normalizeEmail(body.email);
  const password = body.password;

  validateEmail(email);
  validatePassword(password);

  return {
    firstName,
    lastName,
    email,
    password
  };
}

function sanitizeLogin(body = {}) {
  const email = normalizeEmail(body.email);
  const password = body.password;

  validateEmail(email);
  validatePassword(password);

  return {
    email,
    password
  };
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("base64url");
  const key = await scrypt(password, salt, passwordKeyLength);
  return `${passwordAlgorithm}:${salt}:${key.toString("base64url")}`;
}

async function verifyPassword(password, passwordHash) {
  const [algorithm, salt, storedKey] = String(passwordHash || "").split(":");

  if (algorithm !== passwordAlgorithm || !salt || !storedKey) {
    return false;
  }

  const expectedKey = Buffer.from(storedKey, "base64url");
  const actualKey = await scrypt(password, salt, expectedKey.length);

  if (actualKey.length !== expectedKey.length) {
    return false;
  }

  return crypto.timingSafeEqual(actualKey, expectedKey);
}

function getTokenSecret() {
  const secret = process.env.AUTH_TOKEN_SECRET;

  if (secret) {
    return secret;
  }

  if (!isProduction) {
    return "local-development-auth-token-secret";
  }

  const error = new Error("AUTH_TOKEN_SECRET is not configured for this server.");
  error.statusCode = 500;
  throw error;
}

function signToken(user) {
  const payload = {
    sub: user._id.toString(),
    email: user.email,
    exp: Math.floor(Date.now() / 1000) + tokenTtlSeconds
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto
    .createHmac("sha256", getTokenSecret())
    .update(encodedPayload)
    .digest("base64url");

  return `${encodedPayload}.${signature}`;
}

function verifyToken(token) {
  const [encodedPayload, signature] = String(token || "").split(".");

  if (!encodedPayload || !signature) {
    return null;
  }

  const expectedSignature = crypto
    .createHmac("sha256", getTokenSecret())
    .update(encodedPayload)
    .digest("base64url");

  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);

  if (
    actualBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
    if (!payload.sub || !payload.exp || payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

function getBearerToken(request) {
  const authorization = request.headers.authorization || "";
  const [scheme, token] = authorization.split(" ");

  if (scheme?.toLowerCase() !== "bearer" || !token) {
    return "";
  }

  return token;
}

function serializeAuthUser(user) {
  return {
    id: user._id.toString(),
    email: user.email,
    firstName: user.firstName || "",
    lastName: user.lastName || "",
    displayName: user.displayName || [user.firstName, user.lastName].filter(Boolean).join(" "),
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    lastLoginAt: user.lastLoginAt
  };
}

async function ensureAuthIndexes(database) {
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

function requireConfiguredDatabase(response) {
  if (!isDatabaseConfigured()) {
    response.status(503).json({ message: "MongoDB is not configured for this server." });
    return false;
  }

  return true;
}

export function registerAuthRoutes(app) {
  app.get("/api/auth/status", (_request, response) => {
    response.json({
      configured: isDatabaseConfigured(),
      tokenSecretConfigured: Boolean(process.env.AUTH_TOKEN_SECRET) || !isProduction,
      password: {
        minLength: minPasswordLength,
        maxLength: maxPasswordLength
      }
    });
  });

  app.post("/api/auth/register", async (request, response, next) => {
    try {
      if (!requireConfiguredDatabase(response)) {
        return;
      }

      getTokenSecret();
      const registration = sanitizeRegistration(request.body);
      const now = new Date();
      const database = await connectToDatabase();
      await ensureAuthIndexes(database);

      const existingUser = await database
        .collection(userCollectionName)
        .findOne({ email: registration.email });

      if (existingUser?.passwordHash) {
        response.status(409).json({ message: "An account with that email already exists." });
        return;
      }

      const passwordHash = await hashPassword(registration.password);
      const displayName = `${registration.firstName} ${registration.lastName}`;
      let user;

      if (existingUser) {
        user = await database.collection(userCollectionName).findOneAndUpdate(
          { _id: existingUser._id },
          {
            $set: {
              firstName: registration.firstName,
              lastName: registration.lastName,
              displayName,
              passwordHash,
              updatedAt: now
            }
          },
          {
            returnDocument: "after"
          }
        );
      } else {
        const insertResult = await database.collection(userCollectionName).insertOne({
          email: registration.email,
          firstName: registration.firstName,
          lastName: registration.lastName,
          displayName,
          passwordHash,
          createdAt: now,
          updatedAt: now
        });

        user = await database.collection(userCollectionName).findOne({ _id: insertResult.insertedId });
      }

      response.status(201).json({
        user: serializeAuthUser(user),
        token: signToken(user)
      });
    } catch (error) {
      if (error?.code === 11000) {
        response.status(409).json({ message: "An account with that email already exists." });
        return;
      }

      next(error);
    }
  });

  app.post("/api/auth/login", async (request, response, next) => {
    try {
      if (!requireConfiguredDatabase(response)) {
        return;
      }

      getTokenSecret();
      const login = sanitizeLogin(request.body);
      const database = await connectToDatabase();
      await ensureAuthIndexes(database);

      const user = await database.collection(userCollectionName).findOne({ email: login.email });
      const validPassword = user?.passwordHash
        ? await verifyPassword(login.password, user.passwordHash)
        : false;

      if (!user || !validPassword) {
        response.status(401).json({ message: "Invalid email or password." });
        return;
      }

      const updatedUser = await database.collection(userCollectionName).findOneAndUpdate(
        { _id: user._id },
        {
          $set: {
            lastLoginAt: new Date()
          }
        },
        {
          returnDocument: "after"
        }
      );

      response.json({
        user: serializeAuthUser(updatedUser),
        token: signToken(updatedUser)
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/auth/me", async (request, response, next) => {
    try {
      if (!requireConfiguredDatabase(response)) {
        return;
      }

      const payload = verifyToken(getBearerToken(request));

      if (!payload || !ObjectId.isValid(payload.sub)) {
        response.status(401).json({ message: "Sign in is required." });
        return;
      }

      const database = await connectToDatabase();
      const user = await database
        .collection(userCollectionName)
        .findOne({ _id: new ObjectId(payload.sub) });

      if (!user) {
        response.status(401).json({ message: "Sign in is required." });
        return;
      }

      response.json({ user: serializeAuthUser(user) });
    } catch (error) {
      next(error);
    }
  });
}
