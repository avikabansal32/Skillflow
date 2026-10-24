/**
 * SkillFlow — Mongosh Database Initialization Script
 * Usage: mongosh dbs/init_mongo.js
 * or in mongosh interactive shell: load("dbs/init_mongo.js")
 */

// Switch to or create SkillFlow database
const dbName = "skillflow_db";
const sfDb = db.getSiblingDB(dbName);

print(`[SkillFlow MongoDB] Initializing database: ${dbName}...`);

// Ensure users collection exists
if (!sfDb.getCollectionNames().includes("users")) {
  sfDb.createCollection("users");
  print("[SkillFlow MongoDB] Created collection 'users'.");
}

// Create unique index on email
sfDb.users.createIndex({ email: 1 }, { unique: true });
print("[SkillFlow MongoDB] Created unique index on users.email.");

// Seed initial default users if empty
const existingCount = sfDb.users.countDocuments();
if (existingCount === 0) {
  const seedUsers = [
    {
      email: "learner@skillflow.io",
      name: "Alex Rivera",
      passwordHash: "skillflow2026", // Mock hash or password
      createdAt: new Date().toISOString(),
      profileCompleted: true,
      track: "frontend-dev",
      level: "beginner",
      dailyTime: 60
    },
    {
      email: "demo@skillflow.io",
      name: "Taylor Chen",
      passwordHash: "demo1234",
      createdAt: new Date().toISOString(),
      profileCompleted: true,
      track: "python-data",
      level: "intermediate",
      dailyTime: 45
    }
  ];

  sfDb.users.insertMany(seedUsers);
  print(`[SkillFlow MongoDB] Seeded ${seedUsers.length} initial users into 'users' collection.`);
} else {
  print(`[SkillFlow MongoDB] Collection 'users' already has ${existingCount} documents.`);
}

print("[SkillFlow MongoDB] Database initialization complete.");
