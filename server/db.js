import { MongoClient, ServerApiVersion } from "mongodb";

const mongodbUri = process.env.MONGODB_URI;
const databaseName =
  process.env.MONGODB_DB_NAME || "campus-resource-manager";
const configuredServerSelectionTimeoutMs = Number(
  process.env.MONGODB_SERVER_SELECTION_TIMEOUT_MS || 10000
);
const serverSelectionTimeoutMs =
  Number.isFinite(configuredServerSelectionTimeoutMs) && configuredServerSelectionTimeoutMs > 0
    ? configuredServerSelectionTimeoutMs
    : 10000;
const isProduction = process.env.NODE_ENV === "production";

let clientPromise = null;

export function isDatabaseConfigured() {
  return Boolean(mongodbUri);
}

export async function connectToDatabase() {
  if (!mongodbUri) {
    return null;
  }

  if (!clientPromise) {
    const client = new MongoClient(mongodbUri, {
      serverSelectionTimeoutMS: serverSelectionTimeoutMs,
      serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true
      }
    });

    clientPromise = client.connect().catch((error) => {
      clientPromise = null;
      throw error;
    });
  }

  const client = await clientPromise;
  return client.db(databaseName);
}

export async function getDatabaseStatus() {
  if (!isDatabaseConfigured()) {
    return {
      configured: false,
      connected: false
    };
  }

  try {
    const database = await connectToDatabase();
    await database.command({ ping: 1 });
    return {
      configured: true,
      connected: true,
      name: databaseName
    };
  } catch (error) {
    return {
      configured: true,
      connected: false,
      name: databaseName,
      error: isProduction ? "Connection failed" : error.message
    };
  }
}

export async function closeDatabaseConnection() {
  if (!clientPromise) {
    return;
  }

  const client = await clientPromise.catch(() => null);
  if (client) {
    await client.close();
  }
  clientPromise = null;
}
