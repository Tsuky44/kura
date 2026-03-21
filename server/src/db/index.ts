import { drizzle } from 'drizzle-orm/bun-sqlite';
import { Database } from 'bun:sqlite';
import * as schema from './schema';
import { mkdirSync } from 'node:fs';

// Ensure data directory exists for persistence
try {
    mkdirSync('data');
} catch (e) {
    // Ignore if exists
}

const sqlite = new Database('data/movies.db');
export const db = drizzle(sqlite, { schema });
