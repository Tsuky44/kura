import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const movies = sqliteTable('movies', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  title: text('title').notNull(),
  tmdb_id: integer('tmdb_id'),
  summary: text('summary'),
  poster_path: text('poster_path'),
  file_path: text('file_path').notNull().unique(),
  resolution: text('resolution'),
  duration: integer('duration'),
  year: integer('year'),
  created_at: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  progress: integer('progress').default(0),
  last_watched: integer('last_watched', { mode: 'timestamp' }),
});

export const tv_shows = sqliteTable('tv_shows', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  title: text('title').notNull(),
  tmdb_id: integer('tmdb_id'),
  summary: text('summary'),
  poster_path: text('poster_path'),
  backdrop_path: text('backdrop_path'),
  folder_path: text('folder_path').notNull().unique(),
  year: integer('year'),
  created_at: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});

export const tv_seasons = sqliteTable('tv_seasons', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  show_id: integer('show_id').notNull().references(() => tv_shows.id, { onDelete: 'cascade' }),
  season_number: integer('season_number').notNull(),
  title: text('title'),
  summary: text('summary'),
  poster_path: text('poster_path'),
  created_at: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});

export const tv_episodes = sqliteTable('tv_episodes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  season_id: integer('season_id').notNull().references(() => tv_seasons.id, { onDelete: 'cascade' }),
  show_id: integer('show_id').notNull().references(() => tv_shows.id, { onDelete: 'cascade' }),
  episode_number: integer('episode_number').notNull(),
  title: text('title').notNull(),
  tmdb_id: integer('tmdb_id'),
  summary: text('summary'),
  still_path: text('still_path'),
  file_path: text('file_path').notNull().unique(),
  duration: integer('duration'),
  created_at: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  progress: integer('progress').default(0),
  last_watched: integer('last_watched', { mode: 'timestamp' }),
});
