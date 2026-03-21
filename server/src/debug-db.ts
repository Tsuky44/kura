
import { db } from './db';
import { movies } from './db/schema';

async function checkMovies() {
  const allMovies = await db.select().from(movies).all();
  console.log("Total movies:", allMovies.length);
  allMovies.forEach(m => {
    console.log(`ID: ${m.id}, Title: ${m.title}, Path: ${m.file_path}`);
  });
}

checkMovies();
