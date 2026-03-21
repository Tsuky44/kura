import { db } from './db';
import { movies } from './db/schema';
import { like } from 'drizzle-orm';

const search = "%Mission%";
const results = await db.select().from(movies).where(like(movies.title, search));

console.log("Found movies matching 'Mission':");
results.forEach(m => {
    console.log(`ID: ${m.id}`);
    console.log(`Title: ${m.title}`);
    console.log(`File Path: ${m.file_path}`);
    console.log(`Poster: ${m.poster_path}`);
    console.log("-------------------");
});

if (results.length === 0) {
    console.log("No movies found matching 'Mission'. Listing first 5 movies to check DB:");
    const all = await db.select().from(movies).limit(5);
    console.log(JSON.stringify(all, null, 2));
}
